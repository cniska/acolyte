import type { LanguageModelV4ToolCall } from "@ai-sdk/provider";
import { z } from "zod";
import { appConfig } from "./app-config";
import { clampToTokenEstimate, type DistillScope, normalizeMemoryText } from "./distill-ops";
import { log } from "./log";
import {
  defaultMemoryPolicy,
  type MemoryCommitContext,
  type MemoryCommitMetrics,
  type MemoryDistiller,
  type MemoryPolicy,
  type MemoryStore,
  memoryScopeSchema,
} from "./memory-contract";
import { addObservation, resolveScopeKey } from "./memory-ops";
import { getMemoryStore } from "./memory-store";
import { createModel } from "./model-factory";
import { normalizeModel, providerFromModel } from "./provider-config";
import { sharedRateLimiter } from "./rate-limiter";
import { renderTaskActivity, type TaskActivity } from "./task-activity";
import { estimateTokens } from "./token-estimate";
import { toFunctionTool } from "./tool-contract";

const MEMORY_OBSERVE_TOOL = toFunctionTool({
  id: "memory-observe",
  description: "Record a fact extracted from the conversation into memory.",
  inputSchema: z.toJSONSchema(
    z.object({
      scope: memoryScopeSchema,
      content: z.string().min(1),
      topic: z.string().optional(),
    }),
  ) as Record<string, unknown>,
});

export const DISTILLER_PROMPT = `Extract concrete facts from this conversation.

An "observed" entry, if present, is a direct record of what happened this turn — files touched, commands run, whether they succeeded — not something anyone said. Draw facts from it exactly as you would from a message: describe the work itself. The subject of each fact is the file, command, decision, or person — never a message, a log, or the conversation.

For each fact, call memory-observe with:
- scope: "project" for project-specific durable facts (architecture, tooling, conventions, decisions)
         "user" for personal preferences that carry across projects
         "session" for in-progress state, temporary constraints, working assumptions
- content: the fact — preserve specifics: file paths, function names, error messages, config values, decisions with reasoning
- topic: optional single-word topic label (e.g. testing, auth, config, tooling)

If a preference is project-scoped, use "project" not "user". If unsure, default to "session".`;

export type DistillObservation = { scope: DistillScope; content: string; topic: string | null };

export function createDistillInput(
  messages: readonly { role: string; content: string }[],
  output: string,
  activity?: TaskActivity,
): string {
  const digest = activity ? renderTaskActivity(activity) : "";
  const turn = [...messages, { role: "assistant", content: output }];
  const withActivity = digest ? [{ role: "observed", content: digest }, ...turn] : turn;
  return withActivity.map((m) => `${m.role}: ${m.content}`).join("\n\n");
}

export function estimateDistillPromptTokens(
  messages: readonly { role: string; content: string }[],
  output: string,
  activity?: TaskActivity,
): number {
  return estimateTokens(DISTILLER_PROMPT) + estimateTokens(createDistillInput(messages, output, activity));
}

let cachedStore: MemoryStore | null = null;

async function getCachedStore(): Promise<MemoryStore> {
  if (!cachedStore) {
    cachedStore = await getMemoryStore();
  }
  return cachedStore;
}

export type DistillRunner = (systemPrompt: string, userContent: string) => Promise<DistillObservation[]>;

function parseToolCall(call: LanguageModelV4ToolCall): DistillObservation | null {
  try {
    const args = JSON.parse(call.input) as { scope?: unknown; content?: unknown; topic?: unknown };
    if (typeof args.content !== "string" || !args.content.trim()) return null;
    const scope = args.scope as DistillScope;
    if (scope !== "session" && scope !== "project" && scope !== "user") return null;
    const topic = typeof args.topic === "string" && args.topic.trim() ? args.topic.trim().toLowerCase() : null;
    return { scope, content: args.content, topic };
  } catch {
    return null;
  }
}

async function defaultRunner(systemPrompt: string, userContent: string): Promise<DistillObservation[]> {
  const qualifiedModel = normalizeModel(appConfig.distillModel);
  const model = createModel(qualifiedModel, sharedRateLimiter(providerFromModel(qualifiedModel)));
  // The subscription backend rejects non-streaming requests ("Stream must be set to true"), so distill over doStream.
  const { stream } = await model.doStream({
    prompt: [
      { role: "system", content: systemPrompt },
      { role: "user", content: [{ type: "text", text: userContent }] },
    ],
    tools: [MEMORY_OBSERVE_TOOL],
    toolChoice: { type: "auto" },
  });
  const observations: DistillObservation[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.type === "error") throw value.error instanceof Error ? value.error : new Error(String(value.error));
    if (value.type !== "tool-call" || value.toolName !== "memory-observe") continue;
    const obs = parseToolCall(value);
    if (obs) observations.push(obs);
  }
  return observations;
}

async function commitFact(ds: MemoryStore, key: string, content: string, topic: string | null): Promise<number> {
  const record = await addObservation(key, content, { topic, store: ds });
  return record?.tokenEstimate ?? 0;
}

export type DistillerDeps = {
  store: MemoryStore;
  runner: DistillRunner;
  policy: MemoryPolicy;
  commitScope: DistillScope | "none";
};

export function createMemoryDistiller(deps: Partial<DistillerDeps> = {}): MemoryDistiller {
  const runner = deps.runner ?? defaultRunner;
  const policy = deps.policy ?? defaultMemoryPolicy;
  const commitScope = deps.commitScope ?? "session";
  // In-memory: a mark lost on restart costs one redundant distill, whose facts are then mostly
  // absorbed by scope dedup. Persisting it would buy little and outlive the history it indexes.
  const distilledThrough = new Map<string, number>();
  const markDistilled = (sessionId: string | undefined, through: number): void => {
    if (sessionId) distilledThrough.set(sessionId, through);
  };
  return {
    async commit(ctx): Promise<MemoryCommitMetrics | undefined> {
      if (commitScope === "none") return;
      if (commitScope === "session" && !ctx.sessionId) return;
      if (ctx.messages.length < policy.messageThreshold) return;

      const ds = deps.store ?? (await getCachedStore());
      const marked = ctx.sessionId ? (distilledThrough.get(ctx.sessionId) ?? 0) : 0;
      // A mark past the end means history was rewritten under us (an aborted turn is spliced
      // out), so it indexes messages that no longer exist — distrust it rather than skip the turn.
      const alreadyDistilled = marked <= ctx.messages.length ? marked : 0;
      const start = Math.max(alreadyDistilled, ctx.messages.length - policy.contextMessageWindow, 0);
      const recentMessages = ctx.messages.slice(start);
      const distillInput = createDistillInput(recentMessages, ctx.output, ctx.activity);
      const observations = await runner(DISTILLER_PROMPT, distillInput);

      const filtered =
        commitScope === "session" ? observations : observations.filter((obs) => obs.scope === commitScope);
      if (filtered.length === 0) {
        markDistilled(ctx.sessionId, ctx.messages.length);
        return;
      }

      const promptTokens = estimateDistillPromptTokens(recentMessages, ctx.output, ctx.activity);
      let totalTokens = promptTokens;
      let projectCount = 0;
      let userCount = 0;
      let sessionCount = 0;

      for (const obs of filtered) {
        const factKey = resolveScopeKey(obs.scope, ctx, { strict: true });
        if (!factKey) continue;
        const clamped = clampToTokenEstimate(normalizeMemoryText(obs.content), policy.maxOutputTokens);
        if (!clamped) continue;
        totalTokens += await commitFact(ds, factKey, clamped, obs.topic);
        if (obs.scope === "project") projectCount++;
        else if (obs.scope === "user") userCount++;
        else sessionCount++;
      }
      // Only once the facts are persisted: a store failure must leave those messages re-readable.
      markDistilled(ctx.sessionId, ctx.messages.length);

      log.debug("memory.distill.commit_done", {
        session: sessionCount,
        project: projectCount,
        user: userCount,
      });

      return {
        projectPromotedFacts: projectCount,
        userPromotedFacts: userCount,
        sessionScopedFacts: sessionCount,
        distillTokens: totalTokens,
      };
    },
  };
}

const defaultDistiller: MemoryDistiller = createMemoryDistiller();

export function commitDistiller(ctx: MemoryCommitContext): Promise<MemoryCommitMetrics | undefined> {
  return defaultDistiller.commit(ctx);
}
