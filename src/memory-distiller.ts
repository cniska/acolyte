import type { LanguageModelV3FunctionTool, LanguageModelV3ToolCall } from "@ai-sdk/provider";
import { estimateTokens } from "./agent-input";
import { appConfig } from "./app-config";
import { nowIso } from "./datetime";
import { clampToTokenEstimate, type DistillScope, normalizeMemoryText } from "./distill-ops";
import { log } from "./log";
import {
  defaultMemoryPolicy,
  type MemoryCommitContext,
  type MemoryCommitMetrics,
  type MemoryDistiller,
  type MemoryPolicy,
  type MemoryRecord,
  type MemoryStore,
} from "./memory-contract";
import { embeddingToBuffer, embedText } from "./memory-embedding";
import { getMemoryStore } from "./memory-store";
import { createModel } from "./model-factory";
import { normalizeModel, providerFromModel } from "./provider-config";
import { sharedRateLimiter } from "./rate-limiter";
import { defaultUserResourceId, parseResourceId, projectResourceIdFromWorkspace, type ResourceId } from "./resource-id";
import { createId } from "./short-id";

export const DISTILLER_PROMPT = `Extract concrete facts from this conversation.

For each fact, call memory_observe with:
- scope: "project" for project-specific durable facts (architecture, tooling, conventions, decisions)
         "user" for personal preferences that carry across projects
         "session" for in-progress state, temporary constraints, working assumptions
- content: the fact — preserve specifics: file paths, function names, error messages, config values, decisions with reasoning
- topic: optional single-word topic label (e.g. testing, auth, config, tooling)

If a preference is project-scoped, use "project" not "user". If unsure, default to "session".`;

const MEMORY_OBSERVE_TOOL: LanguageModelV3FunctionTool = {
  type: "function",
  name: "memory_observe",
  description: "Record a fact extracted from the conversation into memory.",
  inputSchema: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: ["session", "project", "user"],
        description:
          "Memory scope: session (in-progress), project (durable project facts), user (cross-project preferences)",
      },
      content: {
        type: "string",
        description: "The fact to store. Be specific and concrete.",
      },
      topic: {
        type: "string",
        description: "Optional single-word topic label (e.g. testing, auth, config).",
      },
    },
    required: ["scope", "content"],
  },
};

export type DistillObservation = { scope: DistillScope; content: string; topic: string | null };

export function createDistillInput(messages: readonly { role: string; content: string }[], output: string): string {
  return [...messages, { role: "assistant", content: output }].map((m) => `${m.role}: ${m.content}`).join("\n\n");
}

export function estimateDistillPromptTokens(
  messages: readonly { role: string; content: string }[],
  output: string,
): number {
  return estimateTokens(DISTILLER_PROMPT) + estimateTokens(createDistillInput(messages, output));
}

let cachedStore: MemoryStore | null = null;

async function getCachedStore(): Promise<MemoryStore> {
  if (!cachedStore) {
    cachedStore = await getMemoryStore();
  }
  return cachedStore;
}

async function embedAndStore(ds: MemoryStore, id: string, scope: string, content: string): Promise<void> {
  try {
    const vec = await embedText(content);
    if (vec) await ds.writeEmbedding(id, scope, embeddingToBuffer(vec));
  } catch (error) {
    log.warn("memory.distill.embed_failed", { id, error: String(error) });
  }
}

export type DistillRunner = (systemPrompt: string, userContent: string) => Promise<DistillObservation[]>;

function parseToolCall(call: LanguageModelV3ToolCall): DistillObservation | null {
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
  const result = await model.doGenerate({
    prompt: [
      { role: "system", content: systemPrompt },
      { role: "user", content: [{ type: "text", text: userContent }] },
    ],
    tools: [MEMORY_OBSERVE_TOOL],
    toolChoice: { type: "auto" },
    temperature: 0,
  });
  return result.content
    .filter((part): part is LanguageModelV3ToolCall => part.type === "tool-call" && part.toolName === "memory_observe")
    .map(parseToolCall)
    .filter((obs): obs is DistillObservation => obs !== null);
}

const DISTILL_SCOPE_KEY_RESOLVERS: Record<
  DistillScope,
  (ctx: { sessionId?: string; workspace?: string; resourceId?: ResourceId }) => string | null
> = {
  session: (ctx) => ctx.sessionId ?? null,
  project: (ctx) => {
    const parsed = parseResourceId(ctx.resourceId);
    if (parsed?.startsWith("proj_")) return parsed;
    if (!ctx.workspace) return null;
    return projectResourceIdFromWorkspace(ctx.workspace);
  },
  user: (ctx) => {
    const parsed = parseResourceId(ctx.resourceId);
    if (parsed?.startsWith("user_")) return parsed;
    return defaultUserResourceId();
  },
};

function resolveDistillScopeKey(
  scope: DistillScope,
  ctx: { sessionId?: string; workspace?: string; resourceId?: ResourceId },
): string | null {
  return DISTILL_SCOPE_KEY_RESOLVERS[scope](ctx);
}

async function commitFact(ds: MemoryStore, key: string, content: string, topic: string | null): Promise<number> {
  const existingEntries = await ds.list({ scopeKey: key });
  const latestObservation = existingEntries.filter((e) => e.kind === "observation").slice(-1)[0];
  if (latestObservation && normalizeMemoryText(latestObservation.content) === normalizeMemoryText(content)) return 0;

  const observation: MemoryRecord = {
    id: `mem_${createId()}`,
    scopeKey: key,
    kind: "observation",
    content,
    createdAt: nowIso(),
    tokenEstimate: estimateTokens(content),
    topic,
  };
  await ds.write(observation);
  await embedAndStore(ds, observation.id, key, content);
  log.debug("memory.distill.observation_written", {
    key,
    id: observation.id,
    topic,
    tokens: observation.tokenEstimate,
  });
  return observation.tokenEstimate;
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
  return {
    async commit(ctx): Promise<MemoryCommitMetrics | undefined> {
      if (commitScope === "none") return;
      if (commitScope === "session" && !ctx.sessionId) return;
      if (ctx.messages.length < policy.messageThreshold) return;

      const ds = deps.store ?? (await getCachedStore());
      const recentMessages = ctx.messages.slice(-policy.contextMessageWindow);
      const distillInput = createDistillInput(recentMessages, ctx.output);
      const observations = await runner(DISTILLER_PROMPT, distillInput);

      const filtered =
        commitScope === "session" ? observations : observations.filter((obs) => obs.scope === commitScope);
      if (filtered.length === 0) return;

      const promptTokens = estimateDistillPromptTokens(recentMessages, ctx.output);
      let totalTokens = promptTokens;
      let projectCount = 0;
      let userCount = 0;
      let sessionCount = 0;

      for (const obs of filtered) {
        const factKey = resolveDistillScopeKey(obs.scope, obs.scope === "session" ? { sessionId: ctx.sessionId } : ctx);
        if (!factKey) continue;
        const clamped = clampToTokenEstimate(normalizeMemoryText(obs.content), policy.maxOutputTokens);
        if (!clamped) continue;
        totalTokens += await commitFact(ds, factKey, clamped, obs.topic);
        if (obs.scope === "project") projectCount++;
        else if (obs.scope === "user") userCount++;
        else sessionCount++;
      }

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
