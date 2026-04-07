import { estimateTokens } from "./agent-input";
import { appConfig } from "./app-config";
import { nowIso } from "./datetime";
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

Tag each fact with an observe directive on its own line, followed by the fact on the next line:

@observe project — project-specific durable facts (architecture, tooling, conventions, decisions)
@observe user — personal preferences that carry across projects
@observe session — in-progress state, temporary constraints, working assumptions

If a preference is project-scoped, use @observe project not @observe user. If unsure, default to @observe session.`;

let defaultStore: MemoryStore | null = null;

async function getDefaultStore(): Promise<MemoryStore> {
  if (!defaultStore) {
    defaultStore = await getMemoryStore();
  }
  return defaultStore;
}

type DistillScope = "session" | "project" | "user";

async function embedAndStore(ds: MemoryStore, id: string, scope: string, content: string): Promise<void> {
  try {
    const vec = await embedText(content);
    if (vec) await ds.writeEmbedding(id, scope, embeddingToBuffer(vec));
  } catch (error) {
    log.warn("memory.distill.embed_failed", { id, error: String(error) });
  }
}

const CHARS_PER_TOKEN_ESTIMATE = 4;
const TEXT_SHRINK_RATIO = 0.9;

function clampToTokenEstimate(content: string, maxTokens: number): string {
  const text = content.trim();
  if (!text) return "";
  if (maxTokens <= 0) return "";
  if (estimateTokens(text) <= maxTokens) return text;

  let clamped = text.slice(0, Math.max(1, maxTokens * CHARS_PER_TOKEN_ESTIMATE)).trim();
  while (clamped.length > 0 && estimateTokens(clamped) > maxTokens) {
    clamped = clamped.slice(0, Math.floor(clamped.length * TEXT_SHRINK_RATIO)).trim();
  }
  return clamped;
}

function normalizeMemoryText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseObserveDirective(line: string): DistillScope | null {
  const match = line.trim().match(/^@observe\s+(project|user|session)$/i);
  return match ? (match[1].toLowerCase() as DistillScope) : null;
}

function hasMalformedObserveDirective(line: string): boolean {
  return /^@observe\b/i.test(line.trim()) && !parseObserveDirective(line);
}

function splitScopedObservation(observed: string): {
  session: string;
  project: string;
  user: string;
  sessionCount: number;
  projectCount: number;
  userCount: number;
  droppedUntaggedCount: number;
  droppedMalformedCount: number;
} {
  const lines = observed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const sessionLines: string[] = [];
  const projectLines: string[] = [];
  const userLines: string[] = [];
  let droppedUntaggedCount = 0;
  let droppedMalformedCount = 0;
  let pendingScope: DistillScope | null = null;
  for (const line of lines) {
    // Check for @observe directive
    const scope = parseObserveDirective(line);
    if (scope) {
      pendingScope = scope;
      continue;
    }
    if (hasMalformedObserveDirective(line)) {
      droppedMalformedCount += 1;
      pendingScope = null;
      continue;
    }
    // Fact line — needs a preceding @observe directive
    if (!pendingScope) {
      droppedUntaggedCount += 1;
      continue;
    }
    if (pendingScope === "project") projectLines.push(line);
    else if (pendingScope === "user") userLines.push(line);
    else sessionLines.push(line);
    pendingScope = null;
  }

  return {
    session: sessionLines.join("\n").trim(),
    project: projectLines.join("\n").trim(),
    user: userLines.join("\n").trim(),
    sessionCount: sessionLines.length,
    projectCount: projectLines.length,
    userCount: userLines.length,
    droppedUntaggedCount,
    droppedMalformedCount,
  };
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

async function commitDistillForKey(ds: MemoryStore, key: string, observed: string): Promise<number> {
  const existingEntries = await ds.list({ scopeKey: key });
  const latestObservation = existingEntries.filter((e) => e.kind === "observation").slice(-1)[0];
  if (latestObservation && normalizeMemoryText(latestObservation.content) === normalizeMemoryText(observed)) return 0;

  const observation: MemoryRecord = {
    id: `mem_${createId()}`,
    scopeKey: key,
    kind: "observation",
    content: observed,
    createdAt: nowIso(),
    tokenEstimate: estimateTokens(observed),
  };
  await ds.write(observation);
  await embedAndStore(ds, observation.id, key, observed);
  log.debug("memory.distill.observation_written", { key, id: observation.id, tokens: observation.tokenEstimate });
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
  let malformedRejectStreak = 0;
  return {
    async commit(ctx): Promise<MemoryCommitMetrics | undefined> {
      if (commitScope === "none") return;
      const ds = deps.store ?? (await getDefaultStore());
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
        const usage = await commitDistillForKey(ds, key, observed);
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
        malformedRejectStreak += 1;
        log.debug("memory.distill.dropped_malformed", { key, count: scoped.droppedMalformedCount });
        if (malformedRejectStreak >= policy.malformedStreakWarningThreshold) {
          log.warn("lifecycle.memory.quality_warning", { key, malformed_reject_streak: malformedRejectStreak });
        }
      } else {
        malformedRejectStreak = 0;
      }
      let totalTokens = promptTokens;
      if (scoped.session) {
        totalTokens += await commitDistillForKey(ds, key, scoped.session);
      }
      if (scoped.project) {
        const projectKey = resolveDistillScopeKey("project", ctx);
        if (projectKey) totalTokens += await commitDistillForKey(ds, projectKey, scoped.project);
      }
      if (scoped.user) {
        const userKey = resolveDistillScopeKey("user", ctx);
        if (userKey) totalTokens += await commitDistillForKey(ds, userKey, scoped.user);
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
