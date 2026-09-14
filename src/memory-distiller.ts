import type { LanguageModelV4ToolCall } from "@ai-sdk/provider";
import { z } from "zod";
import { CodedError } from "./coded-error";
import { clampToTokenEstimate, type DistillScope, normalizeMemoryText } from "./distill-ops";
import { ERROR_KINDS, MEMORY_ERROR_CODES } from "./error-contract";
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
  memoryTopicSchema,
  scopeFromKey,
} from "./memory-contract";
import type { embedText } from "./memory-embedding";
import { addObservation, resolveScopeKey, retireMemories, type ScopeContext } from "./memory-ops";
import { searchMemories } from "./memory-recall";
import { getMemoryStore } from "./memory-store";
import { streamModelCall } from "./model-call";
import { createModel, resolveAuthRoute } from "./model-factory";
import { normalizeModel, providerFromModel } from "./provider-config";
import { sharedRateLimiter } from "./rate-limiter";
import { renderTaskActivity, type TaskActivity } from "./task-activity";
import { estimateTokens } from "./token-estimate";
import { toFunctionTool } from "./tool-contract";

/**
 * The four things a turn can leave behind that the repository cannot say for itself. A candidate
 * that fits none of them — how the code now works, where the repository stands, work still ahead —
 * has no value to name, and the model has to name one before it can write an entry.
 */
export const distillFactKindSchema = z.enum(["finding", "decision", "convention", "preference"]);
export type DistillFactKind = z.infer<typeof distillFactKindSchema>;

const DISTILL_FACT_SCHEMA = z.object({
  kind: distillFactKindSchema.describe(
    "finding: what the work discovered — a survey's result, a measurement, what broke and why, how a tool or system outside this checkout behaves. decision: what was settled and the reason, whether or not anything implements it yet. convention: how this project wants to be worked in. preference: what the person wants, or corrected.",
  ),
  content: z
    .string()
    .trim()
    .min(1)
    .describe(
      "One present-tense sentence about the codebase, the project, or the person, understandable by someone who was not here. Figures, names, paths and error text copied exactly from the turn.",
    ),
  scope: memoryScopeSchema,
  // Absent and blank both mean "no topic", and `.optional()` alone accepts only absent. A rejected
  // field fails the whole call, so without this an observation is lost over an optional label.
  topic: memoryTopicSchema.or(z.string().regex(/^\s*$/)).optional(),
  supersedes: z.array(z.string()).default([]),
});

const DISTILL_OUTPUT_SCHEMA = z.object({
  facts: z
    .array(DISTILL_FACT_SCHEMA)
    .describe("Every fact the turn established, in the order found. Empty when it established none."),
});

const DISTILL_ENVELOPE_SCHEMA = z.object({ facts: z.array(z.unknown()) });

const OBSERVE_FUNCTION_NAME = "memory-observe";

/**
 * The only tool offered to the distiller's own model call, and the shape its observations come back
 * in. Nothing executes the call — reading it is the whole handling. The model calls it on every turn,
 * so silence is an empty `facts` array rather than the absence of a call: measured, the model never
 * withholds the call, and a contract that hangs silence on withholding it gets one stray fact instead.
 */
const DISTILL_OUTPUT_TOOL = toFunctionTool({
  id: OBSERVE_FUNCTION_NAME,
  description:
    "Record the facts this turn established. facts holds one entry per fact, in the order found, and is empty when the turn established none.",
  inputSchema: z.toJSONSchema(DISTILL_OUTPUT_SCHEMA) as Record<string, unknown>,
});

export const DISTILLER_PROMPT = `This turn is over, and I am deciding what survives it.

I have two memories. The repository is one: the code, the commits, whatever the work wrote down, all of it readable again next session. This corpus is the other, and it holds the only copy of what the repository cannot say: what the work discovered, what we decided and why, how this project wants to be worked in, what the person I work with wants. Whatever lives only in the conversation is gone when the turn ends unless I write it here.

What I am shown is the request, my own report back to the person, and an "observed" digest of the edits and commands behind it. A report has parts, and I sort by part:
- What I found. A survey's result, a measurement, a comparison, what broke and why, how another tool or system behaves. This exists nowhere else yet, and each finding is its own fact — folding several into one entry loses all but the first.
- What we decided, and the reason. A settled design, the alternative we rejected, a rule the person holds. A decision is a fact the moment it is settled, whether or not anything implements it yet, and I write it as a decision with its reason: "the import keeps project and user scope and drops session, because nothing will ever resume the source session".
- What the person told me they want, or corrected me on. A fact wherever in the turn it appears, even inside the request.
- What I changed: how the code now works, a flag, a path, a schema, a name. The repository states this itself and a copy here only goes stale, so I leave it. When a turn holds both a decision and the detail that implements it, the decision is what I keep.
- Where the repository stands: branch, commits, what is pushed, what verify said. Motion, not knowledge. I leave it.
- What remains: next steps, proposals, work I am about to start. Not true yet. Rewording a task as a description of the project does not make it true, so I leave it.

Each fact is one present-tense sentence about the codebase, the project, or the person, and it stands alone: someone who was not here understands it without asking what "it" refers to. Every figure, unit, name, path and error text in it comes across exactly as the turn said it; where I cannot copy a specific I leave it out rather than reconstruct it, because a plausible substitute survives every later correction. One claim per entry: if I need "and" to hold it together, it is two. Doing a thing once is not how the project works; a convention is one the project states or the person tells me.

Most turns move the repository and teach me nothing it does not now hold. I end those with facts empty, and that is the finished job.

When a "known" block is present, those are facts I already hold, each with an id. I read them before I write anything, because the corpus should sharpen rather than accumulate:
- already there, unchanged — I record nothing. A second copy in different words is the worst thing I can add.
- I can now state it better, more precisely, or with the reason it was missing — I record the sharper version and name the id it replaces in supersedes.
- what I learned contradicts one — I record what is true now and supersede the one that is stale.
- several of them are really one fact — I record the single sharp version and supersede all of them.
- one of them is really two — I record each part separately, and each names the compound it came from.
- genuinely new — I record it and supersede nothing.

I only ever supersede an id from that block, and only from the same scope I am writing to. What I supersede is not deleted; it is kept with a note that this new fact replaced it, so I can be wrong about this and lose nothing.

I call memory-observe once, every turn. facts holds an entry for every fact I keep, in the order I found them, and is empty when I keep none. Each entry carries:
- kind: finding, decision, convention or preference — the part of the report it came from. A candidate that fits none of the four is not a fact.
- content: the fact, keeping the specifics that make it usable — paths, names, figures and their units, error text, the reason behind a decision.
- scope, which decides how long the fact lives:
         "project" — durable and specific to this codebase: architecture, tooling, conventions, decisions. It reaches every future session here.
         "user" — a preference that follows the person across projects, and reaches every session anywhere.
         "session" — true only while this work is open: a temporary constraint, a working assumption. It dies with the session, so it is where I put what I doubt will outlive today — never where I file something that is not a fact.
         A project-scoped preference is "project", not "user". Unsure is "session".
- topic: one lowercase word, when one fits (testing, auth, config, tooling).
- supersedes: the ids this fact replaces, when it replaces any. Omitted otherwise.`;

export type DistillObservation = {
  kind: DistillFactKind;
  scope: DistillScope;
  content: string;
  topic: string | null;
  supersedes: readonly string[];
};

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
  options: { store: MemoryStore; policy: MemoryPolicy; embed?: typeof embedText },
): Promise<readonly MemoryRecord[]> {
  const scopeCtx: ScopeContext = {
    sessionId: ctx.sessionId,
    workspace: ctx.workspace,
    resourceId: ctx.resourceId,
  };
  try {
    return await searchMemories(query, scopeCtx, {
      limit: options.policy.recallCandidateLimit,
      store: options.store,
      policy: options.policy,
      touch: false,
      embed: options.embed,
    });
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

export type DistillRunner = (systemPrompt: string, userContent: string, model: string) => Promise<DistillObservation[]>;

/**
 * An unreadable call is not silence. Silence is an empty `facts` array, and it lets the turn's
 * messages be marked read; a call that cannot be parsed carries facts nobody has seen yet, so it
 * fails the commit and leaves the mark where it was for the next turn to read the window again.
 */
export function parseObservationToolCall(call: Pick<LanguageModelV4ToolCall, "input">): DistillObservation[] {
  let entries: unknown[];
  try {
    const envelope = DISTILL_ENVELOPE_SCHEMA.safeParse(JSON.parse(call.input));
    if (!envelope.success) {
      throw new CodedError(MEMORY_ERROR_CODES.distillUnreadable, "The distiller's answer failed validation", {
        kind: ERROR_KINDS.distillUnreadable,
        cause: envelope.error,
      });
    }
    entries = envelope.data.facts;
  } catch (error) {
    if (error instanceof CodedError) throw error;
    throw new CodedError(MEMORY_ERROR_CODES.distillUnreadable, "The distiller's answer was not readable JSON", {
      kind: ERROR_KINDS.distillUnreadable,
      cause: error,
    });
  }

  const observations: DistillObservation[] = [];
  let rejected = 0;
  for (const entry of entries) {
    const parsed = DISTILL_FACT_SCHEMA.safeParse(entry);
    if (!parsed.success) {
      rejected++;
      continue;
    }
    const { kind, scope, content, topic, supersedes } = parsed.data;
    observations.push({
      kind,
      scope,
      content,
      topic: topic?.trim() ? topic.trim().toLowerCase() : null,
      supersedes: [...new Set(supersedes.map((id) => id.trim()).filter(Boolean))],
    });
  }
  if (rejected > 0) log.warn("memory.distill.rejected_facts", { rejected, kept: observations.length });
  return observations;
}

export async function defaultRunner(
  systemPrompt: string,
  userContent: string,
  model: string,
): Promise<DistillObservation[]> {
  const qualifiedModel = normalizeModel(model);
  const limiter = sharedRateLimiter(providerFromModel(qualifiedModel));
  const client = createModel(qualifiedModel, limiter, await resolveAuthRoute(qualifiedModel));
  // The subscription backend rejects non-streaming requests ("Stream must be set to true"), so distill over doStream.
  const { stream } = await streamModelCall({
    client,
    limiter,
    label: "distill",
    request: {
      prompt: [
        { role: "system", content: systemPrompt },
        { role: "user", content: [{ type: "text", text: userContent }] },
      ],
      tools: [DISTILL_OUTPUT_TOOL],
      toolChoice: { type: "auto" },
    },
  });
  const observations: DistillObservation[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.type === "error") throw value.error instanceof Error ? value.error : new Error(String(value.error));
      if (value.type !== "tool-call" || value.toolName !== OBSERVE_FUNCTION_NAME) continue;
      observations.push(...parseObservationToolCall(value));
    }
  } finally {
    // Leaving early on an error part would otherwise hold the provider connection open.
    reader.cancel().catch(() => {});
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
  /** The scopes an observation may be committed to; one the distiller writes to none of is dropped. */
  commitScopes: readonly DistillScope[];
  embed: typeof embedText;
};

export function createMemoryDistiller(deps: Partial<DistillerDeps> = {}): MemoryDistiller {
  const runner = deps.runner ?? defaultRunner;
  const policy = deps.policy ?? defaultMemoryPolicy;
  const commitScopes = new Set<DistillScope>(deps.commitScopes ?? memoryScopeSchema.options);
  // In-memory: a mark lost on restart costs one redundant distill, whose facts are then mostly
  // absorbed by scope dedup. Persisting it would buy little and outlive the history it indexes.
  const distilledThrough = new Map<string, number>();
  const markDistilled = (sessionId: string | undefined, through: number): void => {
    if (sessionId) distilledThrough.set(sessionId, through);
  };
  return {
    async commit(ctx): Promise<MemoryCommitMetrics | undefined> {
      if (commitScopes.size === 0) return;
      if (commitScopes.has("session") && !ctx.sessionId) return;
      if (ctx.messages.length < policy.messageThreshold) return;

      const ds = deps.store ?? (await getCachedStore());
      const marked = ctx.sessionId ? (distilledThrough.get(ctx.sessionId) ?? 0) : 0;
      // A mark past the end means history was rewritten under us (an aborted turn is spliced
      // out), so it indexes messages that no longer exist — distrust it rather than skip the turn.
      const alreadyDistilled = marked <= ctx.messages.length ? marked : 0;
      const start = Math.max(alreadyDistilled, ctx.messages.length - policy.contextMessageWindow, 0);
      const recentMessages = ctx.messages.slice(start);
      const distillInput = createDistillInput(recentMessages, ctx.output, ctx.activity);
      const foundCandidates = await selectSupersessionCandidates(ctx, distillInput, {
        store: ds,
        policy,
        embed: deps.embed,
      });
      const candidates = selectKnownFactsWithinBudget(foundCandidates, policy.recallCandidateTokenLimit);
      const known = renderKnownFacts(candidates);
      const observations = await runner(
        DISTILLER_PROMPT,
        known ? `${known}\n\n${distillInput}` : distillInput,
        ctx.model,
      );

      const filtered = observations.filter((obs) => commitScopes.has(obs.scope));
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
        const factKey = resolveScopeKey(obs.scope, ctx);
        if (!factKey) {
          // A workspace with no project scope has nowhere to put a project fact; the trace is the
          // only place that shows it, since distillation never speaks in the transcript.
          log.debug("memory.commit.no_scope", { scope: obs.scope });
          continue;
        }
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
