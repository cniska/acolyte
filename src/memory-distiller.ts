import type { LanguageModelV4ToolCall } from "@ai-sdk/provider";
import { z } from "zod";
import { AGENTS_MD_MEMORY_ID } from "./agents-memory-sync";
import { appConfig } from "./app-config";
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
  memoryScopeSchema,
  scopeFromKey,
} from "./memory-contract";
import { addObservation, resolveScopeKey, retireMemories, type ScopeContext } from "./memory-ops";
import { searchMemories } from "./memory-recall";
import { getMemoryStore } from "./memory-store";
import { createModel } from "./model-factory";
import { normalizeModel, providerFromModel } from "./provider-config";
import { sharedRateLimiter } from "./rate-limiter";
import { renderTaskActivity, type TaskActivity } from "./task-activity";
import { estimateTokens } from "./token-estimate";
import { toFunctionTool } from "./tool-contract";

const MEMORY_OBSERVE_INPUT_SCHEMA = z.object({
  scope: memoryScopeSchema,
  content: z.string().trim().min(1),
  topic: z.string().optional(),
  supersedes: z.array(z.string()).default([]),
});

const MEMORY_OBSERVE_TOOL = toFunctionTool({
  id: "memory-observe",
  description: "Record one fact established by this turn's work into memory.",
  inputSchema: z.toJSONSchema(MEMORY_OBSERVE_INPUT_SCHEMA) as Record<string, unknown>,
});

export const DISTILLER_PROMPT = `This turn is over, and I am deciding what survives it.

Conversations are mostly noise: failed attempts, detours, things I read once and can read again. I don't hoard them. I keep what mattered and let the rest go, and the durable part is all I will have of this work next session.

What mattered is what I would want to know later and could not recover by reading the code:
- a decision, and the reason behind it — especially a reason the result does not show
- a constraint the work discovered: what broke, and why it broke
- how this project wants to be worked in — its commands, conventions, and the rules its owner holds
- who I am working with: what they prefer, what they corrected me on

Anything one file-read would tell me again is not worth carrying. Directory listings, a constant's current value, line numbers, counts, a file's first line, the names of tools I already have — the code moves and those become lies. An intention is not a fact either: a plan I am about to carry out is superseded the moment I carry it out, so I record what the work established, not what it was going to do.

Each fact stands alone and states a claim about the work — a file, a command, a decision, a person. Never about the conversation, the message, or the log. Someone who was not here understands it without asking what "it" refers to. One claim per call: if I need "and" to hold it together, it is two facts. I never write the same fact twice.

An "observed" entry, when present, is what actually happened this turn — files touched, commands run, whether they succeeded. I read it exactly as I read a message: the subject is the work, not the record of it.

Most turns leave one or two facts worth keeping. Some leave none, and then I record nothing — that is the right answer, not a failure. A small sharp corpus I trust beats a large one I stop reading.

When a "known" block is present, those are facts I already hold, each with an id. I read them before I write anything, because the corpus should sharpen rather than accumulate:
- already there, unchanged — I record nothing. A second copy in different words is the worst thing I can add.
- I can now state it better, more precisely, or with the reason it was missing — I record the sharper version and name the id it replaces in supersedes.
- what I learned contradicts one — I record what is true now and supersede the one that is stale.
- several of them are really one fact — I record the single sharp version and supersede all of them.
- one of them is really two — I record each part separately, and each names the compound it came from.
- genuinely new — I record it and supersede nothing.

I only ever supersede an id from that block, and only from the same scope I am writing to. What I supersede is not deleted; it is kept with a note that this new fact replaced it, so I can be wrong about this and lose nothing.

For each fact I keep, I call memory-observe with:
- scope, which decides how long the fact lives:
         "project" — durable and specific to this codebase: architecture, tooling, conventions, decisions. It reaches every future session here.
         "user" — a preference that follows the person across projects, and reaches every session anywhere.
         "session" — true only while this work is open: in-progress state, a temporary constraint, a working assumption. It dies with the session, so it is where I put what I doubt will outlive today — never where I file something that failed the bar above.
         A project-scoped preference is "project", not "user". Unsure is "session".
- content: the fact, keeping the specifics that make it usable — paths, names, error text, the reasoning behind a decision.
- topic: one lowercase word, when one fits (testing, auth, config, tooling).
- supersedes: the ids this fact replaces, when it replaces any. Omitted otherwise.`;

export type DistillObservation = {
  scope: DistillScope;
  content: string;
  topic: string | null;
  supersedes: readonly string[];
};

// The AGENTS.md record is a projection of a file, not a fact anyone wrote: the file is its truth,
// and its sync short-circuits on an unchanged snapshot, so a supersession would drop the project's
// rules from recall until AGENTS.md next changes.
function isHostManaged(record: MemoryRecord): boolean {
  return record.id === AGENTS_MD_MEMORY_ID;
}

export function renderKnownFacts(candidates: readonly MemoryRecord[]): string {
  if (candidates.length === 0) return "";
  const lines = candidates.map((r) => `${r.id} (${scopeFromKey(r.scopeKey)}): ${normalizeMemoryText(r.content)}`);
  return `known:\n${lines.join("\n")}`;
}

export function selectKnownFactsWithinBudget(candidates: readonly MemoryRecord[], maxTokens: number): MemoryRecord[] {
  const selected: MemoryRecord[] = [];
  for (const candidate of candidates) {
    const next = [...selected, candidate];
    if (estimateTokens(renderKnownFacts(next)) <= maxTokens) selected.push(candidate);
  }
  return selected;
}

/**
 * The one seam the undecided recall-as-DNA question can reshape: how existing facts reach the
 * distiller. Everything downstream consumes the returned records and nothing else.
 */
export async function selectSupersessionCandidates(
  ctx: MemoryCommitContext,
  query: string,
  options: { store: MemoryStore; policy: MemoryPolicy },
): Promise<readonly MemoryRecord[]> {
  const scopeCtx: ScopeContext = {
    sessionId: ctx.sessionId,
    workspace: ctx.workspace,
    resourceId: ctx.resourceId,
  };
  try {
    const found = await searchMemories(query, scopeCtx, {
      limit: options.policy.recallCandidateLimit,
      store: options.store,
      policy: options.policy,
      touch: false,
    });
    return found.filter((record) => !isHostManaged(record));
  } catch (error) {
    // Distillation without candidates still writes correct new facts; it just cannot supersede.
    log.warn("memory.distill.candidates_failed", { error: String(error) });
    return [];
  }
}

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
  candidates: readonly MemoryRecord[] = [],
): number {
  return (
    estimateTokens(DISTILLER_PROMPT) +
    estimateTokens(createDistillInput(messages, output, activity)) +
    estimateTokens(renderKnownFacts(candidates))
  );
}

let cachedStore: MemoryStore | null = null;

async function getCachedStore(): Promise<MemoryStore> {
  if (!cachedStore) {
    cachedStore = await getMemoryStore();
  }
  return cachedStore;
}

export type DistillRunner = (systemPrompt: string, userContent: string) => Promise<DistillObservation[]>;

export function parseToolCall(call: Pick<LanguageModelV4ToolCall, "input">): DistillObservation | null {
  try {
    const parsed = MEMORY_OBSERVE_INPUT_SCHEMA.safeParse(JSON.parse(call.input));
    if (!parsed.success) return null;
    const { scope, content, topic, supersedes } = parsed.data;
    return {
      scope,
      content,
      topic: topic?.trim() ? topic.trim().toLowerCase() : null,
      supersedes: [...new Set(supersedes.map((id) => id.trim()).filter(Boolean))],
    };
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

function commitFact(ds: MemoryStore, key: string, content: string, topic: string | null): Promise<MemoryRecord | null> {
  return addObservation(key, content, { topic, store: ds });
}

/**
 * A supersession the model asked for is honored only if it names a record it was actually shown
 * and one it could have written itself — otherwise the model could retire facts it never saw.
 */
async function retireSuperseded(ds: MemoryStore, successorsBySuperseded: Map<string, string[]>): Promise<number> {
  let count = 0;
  for (const [supersededId, successors] of successorsBySuperseded) {
    try {
      const retired = await retireMemories(
        [supersededId],
        { kind: "superseded", by: [...new Set(successors)] },
        { store: ds },
      );
      count += retired.length;
    } catch (error) {
      // The successor is already stored, so a failed retirement leaves the corpus redundant rather
      // than wrong, and the facts this turn established are not worth losing to it.
      log.warn("memory.distill.retire_failed", { id: supersededId, error: String(error) });
    }
  }
  return count;
}

export function validateSupersedes(
  requested: readonly string[],
  shown: readonly MemoryRecord[],
  scopeKey: string,
): string[] {
  const eligible = new Map(shown.filter((record) => record.scopeKey === scopeKey).map((r) => [r.id, r]));
  return [...new Set(requested)].filter((id) => eligible.has(id));
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
      const foundCandidates = await selectSupersessionCandidates(ctx, distillInput, { store: ds, policy });
      const candidates = selectKnownFactsWithinBudget(foundCandidates, policy.recallCandidateTokenLimit);
      const known = renderKnownFacts(candidates);
      const observations = await runner(DISTILLER_PROMPT, known ? `${known}\n\n${distillInput}` : distillInput);

      const filtered =
        commitScope === "session" ? observations : observations.filter((obs) => obs.scope === commitScope);
      const promptTokens = estimateDistillPromptTokens(recentMessages, ctx.output, ctx.activity, candidates);
      if (filtered.length === 0) {
        markDistilled(ctx.sessionId, ctx.messages.length);
        return {
          projectPromotedFacts: 0,
          userPromotedFacts: 0,
          sessionScopedFacts: 0,
          supersededFacts: 0,
          candidateCount: candidates.length,
          distillTokens: promptTokens,
        };
      }

      let totalTokens = promptTokens;
      let projectCount = 0;
      let userCount = 0;
      let sessionCount = 0;
      const successorsBySuperseded = new Map<string, string[]>();

      for (const obs of filtered) {
        const factKey = resolveScopeKey(obs.scope, ctx, { strict: true });
        if (!factKey) continue;
        const clamped = clampToTokenEstimate(normalizeMemoryText(obs.content), policy.maxOutputTokens);
        if (!clamped) continue;
        const record = await commitFact(ds, factKey, clamped, obs.topic);
        // No record means the write was deduplicated away: nothing was promoted, and a supersession
        // with nothing to point at would archive a fact into a dangling lineage.
        if (!record) continue;
        totalTokens += record.tokenEstimate;
        if (obs.scope === "project") projectCount++;
        else if (obs.scope === "user") userCount++;
        else sessionCount++;

        for (const id of validateSupersedes(obs.supersedes, candidates, factKey)) {
          const successors = successorsBySuperseded.get(id) ?? [];
          successors.push(record.id);
          successorsBySuperseded.set(id, successors);
        }
      }
      // Only once the facts are persisted: a store failure must leave those messages re-readable.
      markDistilled(ctx.sessionId, ctx.messages.length);

      // After every write, and grouped by superseded id: a split names all of its successors, and
      // retiring one record cannot cost the facts a later observation would still have written.
      const supersededCount = await retireSuperseded(ds, successorsBySuperseded);

      log.debug("memory.distill.commit_done", {
        session: sessionCount,
        project: projectCount,
        user: userCount,
        superseded: supersededCount,
        candidates: candidates.length,
      });

      return {
        projectPromotedFacts: projectCount,
        userPromotedFacts: userCount,
        sessionScopedFacts: sessionCount,
        supersededFacts: supersededCount,
        candidateCount: candidates.length,
        distillTokens: totalTokens,
      };
    },
  };
}

const defaultDistiller: MemoryDistiller = createMemoryDistiller();

export function commitDistiller(ctx: MemoryCommitContext): Promise<MemoryCommitMetrics | undefined> {
  return defaultDistiller.commit(ctx);
}
