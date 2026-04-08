import { estimateTokens } from "./agent-input";
import { appConfig } from "./app-config";
import { nowIso } from "./datetime";
import { clampToTokenEstimate, type DistillScope, normalizeMemoryText, splitScopedObservation } from "./distill-ops";
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

Preserve specifics: file paths, function names, error messages, config values, decisions with reasoning.

Tag each fact with an observe directive on its own line, optionally followed by a topic tag, then the fact on the next line:

@observe project — project-specific durable facts (architecture, tooling, conventions, decisions)
@observe user — personal preferences that carry across projects
@observe session — in-progress state, temporary constraints, working assumptions
@topic <word> — optional topic tag for the preceding observe (e.g. testing, auth, config, tooling)

Example:
@observe project
@topic testing
Project uses Vitest for unit tests

If a preference is project-scoped, use @observe project not @observe user. If unsure, default to @observe session.`;

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

export type DistillRunner = (systemPrompt: string, userContent: string) => Promise<string>;

async function defaultRunner(systemPrompt: string, userContent: string): Promise<string> {
  const qualifiedModel = normalizeModel(appConfig.distillModel);
  const model = createModel(qualifiedModel, sharedRateLimiter(providerFromModel(qualifiedModel)));
  const result = await model.doGenerate({
    prompt: [
      { role: "system", content: systemPrompt },
      { role: "user", content: [{ type: "text", text: userContent }] },
    ],
    temperature: 0,
  });
  const text = result.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
  return text.trim();
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
  const malformedStreaks = new Map<string, number>();
  return {
    async commit(ctx): Promise<MemoryCommitMetrics | undefined> {
      if (commitScope === "none") return;
      const ds = deps.store ?? (await getCachedStore());
      const key = resolveDistillScopeKey(commitScope, ctx);
      if (!key) return;
      if (ctx.messages.length < policy.messageThreshold) return;

      const recentMessages = ctx.messages.slice(-policy.contextMessageWindow);
      const distillInput = [...recentMessages, { role: "assistant", content: ctx.output }]
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n\n");
      const observedRaw = await runner(DISTILLER_PROMPT, distillInput);
      const observed = clampToTokenEstimate(observedRaw, policy.maxOutputTokens);
      if (!observed.trim()) return;
      const promptTokens = estimateTokens(DISTILLER_PROMPT) + estimateTokens(distillInput) + estimateTokens(observed);
      if (commitScope !== "session") {
        const usage = await commitFact(ds, key, observed, null);
        const observedFactCount = observed.split(/\r?\n/).filter((line) => line.trim()).length;
        return {
          projectPromotedFacts: commitScope === "project" ? observedFactCount : 0,
          userPromotedFacts: commitScope === "user" ? observedFactCount : 0,
          sessionScopedFacts: 0,
          droppedUntaggedFacts: 0,
          distillTokens: promptTokens + usage,
        };
      }

      const scoped = splitScopedObservation(observed);
      if (scoped.droppedUntaggedCount > 0) {
        log.debug("memory.distill.dropped_untagged", { key, count: scoped.droppedUntaggedCount });
      }
      if (scoped.droppedMalformedCount > 0) {
        const streak = (malformedStreaks.get(key) ?? 0) + 1;
        malformedStreaks.set(key, streak);
        log.debug("memory.distill.dropped_malformed", { key, count: scoped.droppedMalformedCount });
        if (streak >= policy.malformedStreakWarningThreshold) {
          log.warn("lifecycle.memory.quality_warning", { key, malformed_reject_streak: streak });
        }
      } else {
        malformedStreaks.delete(key);
      }
      let totalTokens = promptTokens;
      for (const fact of scoped.facts) {
        const factKey = resolveDistillScopeKey(fact.scope, fact.scope === "session" ? { sessionId: key } : ctx);
        if (factKey) totalTokens += await commitFact(ds, factKey, fact.content, fact.topic);
      }
      log.debug("memory.distill.commit_done", {
        key,
        session: scoped.sessionCount,
        project: scoped.projectCount,
        user: scoped.userCount,
        dropped: scoped.droppedUntaggedCount,
      });
      return {
        projectPromotedFacts: scoped.projectCount,
        userPromotedFacts: scoped.userCount,
        sessionScopedFacts: scoped.sessionCount,
        droppedUntaggedFacts: scoped.droppedUntaggedCount,
        distillTokens: totalTokens,
      };
    },
  };
}

const defaultDistiller: MemoryDistiller = createMemoryDistiller();

export function commitDistiller(ctx: MemoryCommitContext): Promise<MemoryCommitMetrics | undefined> {
  return defaultDistiller.commit(ctx);
}
