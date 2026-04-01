import { estimateTokens } from "./agent-input";
import { appConfig } from "./app-config";
import { nowIso } from "./datetime";
import { log } from "./log";
import type {
  MemoryCommitMetrics,
  MemoryRecord,
  MemorySource,
  MemorySourceEntry,
  MemoryStore,
} from "./memory-contract";
import { OBSERVER_PROMPT, REFLECTOR_PROMPT } from "./memory-distill-prompts";
import { embeddingToBuffer, embedText } from "./memory-embedding";

import { defaultMemoryPolicy, type MemoryPolicy } from "./memory-policy";
import { getDefaultMemoryStore } from "./memory-store";
import { createModel } from "./model-factory";
import { normalizeModel, providerFromModel } from "./provider-config";
import { sharedRateLimiter } from "./rate-limiter";
import { defaultUserResourceId, parseResourceId, projectResourceIdFromWorkspace, type ResourceId } from "./resource-id";
import { createId } from "./short-id";

export type DistillConfig = {
  model: string;
  messageThreshold: number;
  reflectionThresholdTokens: number;
  maxOutputTokens: number;
};

let defaultStore: MemoryStore | null = null;

function getDefaultStore(): MemoryStore {
  if (!defaultStore) {
    defaultStore = getDefaultMemoryStore();
  }
  return defaultStore;
}

type DistillScope = "session" | "project" | "user";

type DistillSourceOptions = {
  id?: string;
  loadScope?: DistillScope;
  commitScope?: DistillScope | "none";
  config?: DistillConfig;
  policy?: MemoryPolicy;
};

function embedAndStore(ds: MemoryStore, id: string, scope: string, content: string): void {
  embedText(content)
    .then((vec) => {
      if (vec) ds.writeEmbedding(id, scope, embeddingToBuffer(vec));
    })
    .catch((error) => {
      log.warn("memory.distill.embed_failed", { id, error: String(error) });
    });
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

function needsReflectionRetry(reflected: string, sourceTokenEstimate: number, config: DistillConfig): boolean {
  const reflectedTokens = estimateTokens(reflected);
  return reflectedTokens >= sourceTokenEstimate || reflectedTokens > config.reflectionThresholdTokens;
}

function parseContinuationState(text: string): { currentTask?: string; nextStep?: string } {
  const currentTask = extractLastLineValue(text, /^(?:[-*]\s*)?Current task:\s*(.+)$/gim);
  const nextStep = extractLastLineValue(text, /^(?:[-*]\s*)?Next step:\s*(.+)$/gim);
  return {
    ...(currentTask ? { currentTask } : {}),
    ...(nextStep ? { nextStep } : {}),
  };
}

export function extractLastLineValue(text: string, pattern: RegExp): string | undefined {
  const matches = Array.from(text.matchAll(pattern));
  const value = matches[matches.length - 1]?.[1]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function continuationEntries(record: { currentTask?: string; nextStep?: string } | undefined): string[] {
  if (!record) return [];
  const lines: string[] = [];
  if (record.currentTask) lines.push(`Current task: ${record.currentTask}`);
  if (record.nextStep) lines.push(`Next step: ${record.nextStep}`);
  return lines;
}

function stripContinuationLines(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => !/^(?:[-*]\s*)?(?:Current task|Next step):\s*/i.test(line));
  return lines.join("\n").trim();
}

function normalizeMemoryText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isContinuationLine(line: string): boolean {
  return /^(?:[-*]\s*)?(?:Current task|Next step):\s*/i.test(line.trim());
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
    // Check for @scope directive
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
    // Continuation state is always session-scoped
    if (isContinuationLine(line)) {
      sessionLines.push(line);
      pendingScope = null;
      continue;
    }
    // Fact line — needs a preceding @scope directive
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

const defaultDistillConfig = (): DistillConfig => appConfig.distill;

async function runDistillLLM(systemPrompt: string, userContent: string): Promise<string> {
  const qualifiedModel = normalizeModel(appConfig.distill.model);
  const model = createModel(qualifiedModel, sharedRateLimiter(providerFromModel(qualifiedModel)));
  const result = await model.doGenerate({
    prompt: [
      { role: "system", content: systemPrompt },
      { role: "user", content: [{ type: "text", text: userContent }] },
    ],
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

async function loadEntriesForKey(ds: MemoryStore, key: string): Promise<readonly MemorySourceEntry[]> {
  const entries = await ds.list({ scopeKey: key });
  const reflections = entries.filter((e) => e.kind === "reflection");
  if (reflections.length > 0) {
    // Safe: guarded by `reflections.length > 0` above.
    const latestReflection = reflections[reflections.length - 1] as MemoryRecord;
    const observationsSinceReflection = entries
      .filter((e) => e.kind === "observation" && e.createdAt > latestReflection.createdAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const mostRecent = observationsSinceReflection[0] ?? latestReflection;
    const reflectionContent = stripContinuationLines(latestReflection.content);
    return [
      ...(reflectionContent ? [{ content: reflectionContent, recordId: latestReflection.id }] : []),
      ...observationsSinceReflection.flatMap((e) => {
        const content = stripContinuationLines(e.content);
        return content.length > 0 ? [{ content, recordId: e.id }] : [];
      }),
      ...continuationEntries(mostRecent).map((content) => ({ content, isContinuation: true as const })),
    ];
  }
  const observationEntries = entries
    .filter((e) => e.kind === "observation")
    .slice()
    .reverse();
  const mostRecent = observationEntries[0];
  return [
    ...observationEntries.flatMap((e) => {
      const content = stripContinuationLines(e.content);
      return content.length > 0 ? [{ content, recordId: e.id }] : [];
    }),
    ...continuationEntries(mostRecent).map((content) => ({ content, isContinuation: true as const })),
  ];
}

async function commitDistillForKey(
  ds: MemoryStore,
  key: string,
  observed: string,
  runner: DistillRunner,
  config: DistillConfig,
  policy: MemoryPolicy,
): Promise<void> {
  const existingEntries = await ds.list({ scopeKey: key });
  const latestObservation = existingEntries.filter((e) => e.kind === "observation").slice(-1)[0];
  if (latestObservation && normalizeMemoryText(latestObservation.content) === normalizeMemoryText(observed)) return;

  const observation: MemoryRecord = {
    id: `dst_${createId()}`,
    scopeKey: key,
    kind: "observation",
    content: observed,
    ...parseContinuationState(observed),
    createdAt: nowIso(),
    tokenEstimate: estimateTokens(observed),
  };
  await ds.write(observation);
  embedAndStore(ds, observation.id, key, observed);
  log.debug("memory.distill.observation_written", { key, id: observation.id, tokens: observation.tokenEstimate });

  const entries = [...existingEntries, observation];
  const observations = entries.filter((e) => e.kind === "observation");
  const reflections = entries.filter((e) => e.kind === "reflection");
  const latestReflection = reflections[reflections.length - 1];
  const pendingObservations = latestReflection
    ? observations.filter((e) => e.createdAt > latestReflection.createdAt)
    : observations;
  const totalTokens = pendingObservations.reduce((sum, e) => sum + e.tokenEstimate, 0);
  if (totalTokens < config.reflectionThresholdTokens) return;

  const allObservations = pendingObservations.map((o) => o.content).join("\n\n---\n\n");
  let reflected = "";
  for (let attempt = 0; attempt <= policy.reflectionRetryLimit; attempt += 1) {
    const promptSuffix =
      attempt === 0
        ? ""
        : "\n\nCompression retry: keep all critical facts while reducing length and merging redundant details.";
    const reflectedRaw = await runner(REFLECTOR_PROMPT, `${allObservations}${promptSuffix}`);
    reflected = clampToTokenEstimate(reflectedRaw, config.maxOutputTokens);
    if (!reflected.trim()) return;
    if (!needsReflectionRetry(reflected, totalTokens, config)) break;
  }
  if (needsReflectionRetry(reflected, totalTokens, config)) return;

  const reflection: MemoryRecord = {
    id: `dst_${createId()}`,
    scopeKey: key,
    kind: "reflection",
    content: reflected,
    ...parseContinuationState(reflected),
    createdAt: nowIso(),
    tokenEstimate: estimateTokens(reflected),
  };
  await ds.write(reflection);
  embedAndStore(ds, reflection.id, key, reflected);
  log.debug("memory.distill.reflection_written", { key, id: reflection.id, tokens: reflection.tokenEstimate });

  // GC: remove all prior observations and reflections now consolidated into the new reflection.
  const stale = [...observations, ...reflections];
  for (const r of stale) await ds.remove(r.id);
  log.debug("memory.distill.gc", { key, removed: stale.length });
}

export function createDistillMemorySource(
  injectedStore?: MemoryStore,
  runner: DistillRunner = runDistillLLM,
  options: DistillSourceOptions = {},
): MemorySource {
  const ds = injectedStore ?? getDefaultStore();
  const config = options.config ?? defaultDistillConfig();
  const policy = options.policy ?? defaultMemoryPolicy;
  const id = options.id ?? "distill_session";
  const loadScope = options.loadScope ?? "session";
  const commitScope = options.commitScope ?? "session";
  let malformedRejectStreak = 0;
  return {
    id,

    async loadEntries(ctx) {
      const key = resolveDistillScopeKey(loadScope, ctx);
      if (!key) return [];
      return loadEntriesForKey(ds, key);
    },

    async commit(ctx): Promise<MemoryCommitMetrics | undefined> {
      if (commitScope === "none") return;
      const key = resolveDistillScopeKey(commitScope, ctx);
      if (!key) return;
      if (ctx.messages.length < config.messageThreshold) return;

      const recentMessages = ctx.messages.slice(-policy.contextMessageWindow);
      const distillInput = [...recentMessages, { role: "assistant", content: ctx.output }]
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n\n");
      const observedRaw = await runner(OBSERVER_PROMPT, distillInput);
      const observed = clampToTokenEstimate(observedRaw, config.maxOutputTokens);
      if (!observed.trim()) return;
      if (commitScope !== "session") {
        await commitDistillForKey(ds, key, observed, runner, config, policy);
        const observedFactCount = observed.split(/\r?\n/).filter((line) => line.trim()).length;
        return {
          projectPromotedFacts: commitScope === "project" ? observedFactCount : 0,
          userPromotedFacts: commitScope === "user" ? observedFactCount : 0,
          sessionScopedFacts: 0,
          droppedUntaggedFacts: 0,
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
      if (scoped.session) {
        await commitDistillForKey(ds, key, scoped.session, runner, config, policy);
      }

      if (scoped.project) {
        const projectKey = resolveDistillScopeKey("project", ctx);
        if (projectKey) await commitDistillForKey(ds, projectKey, scoped.project, runner, config, policy);
      }
      if (scoped.user) {
        const userKey = resolveDistillScopeKey("user", ctx);
        if (userKey) await commitDistillForKey(ds, userKey, scoped.user, runner, config, policy);
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
      };
    },
  };
}

export const distillMemorySource: MemorySource = createDistillMemorySource();
export const distillProjectMemorySource: MemorySource = createDistillMemorySource(undefined, runDistillLLM, {
  id: "distill_project",
  loadScope: "project",
  commitScope: "none",
});
export const distillUserMemorySource: MemorySource = createDistillMemorySource(undefined, runDistillLLM, {
  id: "distill_user",
  loadScope: "user",
  commitScope: "none",
});
