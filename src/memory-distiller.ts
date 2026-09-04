import type { LanguageModelV4ToolCall } from "@ai-sdk/provider";
import { z } from "zod";
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
  memoryTopicSchema,
  scopeFromKey,
} from "./memory-contract";
import type { embedText } from "./memory-embedding";
import { addObservation, resolveScopeKey, retireMemories, type ScopeContext } from "./memory-ops";
import { searchMemories } from "./memory-recall";
import { getMemoryStore } from "./memory-store";
import { streamModelCall } from "./model-call";
import { createModel } from "./model-factory";
import { normalizeModel, providerFromModel } from "./provider-config";
import { sharedRateLimiter } from "./rate-limiter";
import { renderTaskActivity, type TaskActivity } from "./task-activity";
import { estimateTokens } from "./token-estimate";
import { toFunctionTool } from "./tool-contract";

const DISTILL_FACT_SCHEMA = z.object({
  scope: memoryScopeSchema,
  content: z.string().trim().min(1),
  // Absent and blank both mean "no topic", and `.optional()` alone accepts only absent. A rejected
  // field fails the whole call, so without this an observation is lost over an optional label.
  topic: memoryTopicSchema.or(z.string().regex(/^\s*$/)).optional(),
  supersedes: z.array(z.string()).default([]),
});

const DISTILL_OUTPUT_SCHEMA = z.object({
  facts: z.array(DISTILL_FACT_SCHEMA),
});

const OBSERVE_FUNCTION_NAME = "memory-observe";

/**
 * The only tool offered to the distiller's own model call, and the shape its observations come back
 * in. Nothing executes the call — reading it is the whole handling — and returning none is how a turn
 * says it established nothing.
 */
const DISTILL_OUTPUT_TOOL = toFunctionTool({
  id: OBSERVE_FUNCTION_NAME,
  description:
    "Record the facts that outlive this turn, one entry each, stated as what is now true. Most turns establish none and do not call this at all.",
  inputSchema: z.toJSONSchema(DISTILL_OUTPUT_SCHEMA) as Record<string, unknown>,
});

export const DISTILLER_PROMPT = `This turn is over, and I am deciding what survives it.

I have two memories. The repository is one: every file, every commit, whatever the work wrote down, all of it readable again next session — including what is true of it right now, which branch, which commit, what is pushed. This corpus is the other, and it holds the only copy of everything the repository cannot say: what we decided and why, what we rejected, what the work discovered, what the person I work with wants. When the turn ends, whatever lives only in the conversation is gone unless I write it here.

One question decides every candidate: which memory already holds it. If a file read or a git command would tell me again — what the code now does, a flag, a path, a constant's value, where a commit sits — the repository is carrying it, and a copy here only goes stale. That covers this checkout and nothing else: another tool, another agent's files, a service, a machine is not my repository, so what I learn about one has no other home no matter how I found it. What I keep is what has no other home:
- a decision, and the reason behind it — especially the alternative we rejected, which no diff shows
- a constraint the work discovered: what broke and why, what a survey of the world outside this repo found
- how this project wants to be worked in — its conventions and the rules its owner holds
- who I am working with: what they prefer, what they corrected me on

What I found this turn outranks what I was handed. A request or a handoff carries what someone already knew, and it will still be there to read; what I established here — what a survey turned up, what a comparison showed, what a measurement said — exists nowhere else yet, and each finding is its own fact. The durable part of a turn is usually its least concrete part. A settled seam, a rejected approach, a reason — those read like mere talk next to a crisp implementation detail, and they are the facts; the crisp detail is the copy the repository already keeps. When a turn holds both, the decision is what I record, carrying only the specifics that make it usable.

I write each fact in the present tense, with the codebase, the project or the person as its subject: "the pre-push hook rejects placeholder author domains", "he wants provider setup kept outside the TUI". That sentence is the whole test. What I did this turn is how I found the fact out, never the fact itself, so a commit, a branch, a file I added, a command that passed, a plan I made are the route and what I record is the destination. When the only sentence I can write has an act as its subject — added, removed, fixed, reset, "commit abc1234", "plan:", "he asked me to" — I have the route in hand, and I write the state it left behind instead — unless that state is the repository's own, a branch or a commit or what is pushed, which it already holds — or I write nothing. A proposal is route too: what I am about to build is not yet true, and I record only what was settled.

A design we only talked through leaves nothing behind in the code, and it is the case I get wrong most. The fact there is the decision itself, and every number, unit, name and signature in it comes across exactly as it was said — I copy those out of the turn, I do not reconstruct them from what they sound like. Where I cannot copy a specific, I record the decision without it: a plausible substitute for a figure I half-remember is the one kind of wrong that survives every later correction.

Each fact stands alone. Someone who was not here understands it without asking what "it" refers to. One claim per call: if I need "and" to hold it together, it is two facts. I never write the same fact twice. A turn carries as many facts as it carries, and one call is not a quota: when the work surveyed several things, each finding is its own call, and folding them into a single entry to keep the count down loses every one of them but the first.

An "observed" entry, when present, is what actually happened this turn — files touched, commands run, whether they succeeded. It is route as well: it tells me what I learned from, and I record what I learned.

Every fact I keep is a line future-me rereads for as long as it lives, so each one pays rent. Most turns are routine: they move the repository and teach me nothing the repository does not now hold, and I end them without calling the tool at all. Silence is the finished job on such a turn. Doing a thing once is not how the project works: a convention is one the project states or the person tells me, never one I generalize from an act I just performed.

When a "known" block is present, those are facts I already hold, each with an id. I read them before I write anything, because the corpus should sharpen rather than accumulate:
- already there, unchanged — I record nothing. A second copy in different words is the worst thing I can add.
- I can now state it better, more precisely, or with the reason it was missing — I record the sharper version and name the id it replaces in supersedes.
- what I learned contradicts one — I record what is true now and supersede the one that is stale.
- several of them are really one fact — I record the single sharp version and supersede all of them.
- one of them is really two — I record each part separately, and each names the compound it came from.
- genuinely new — I record it and supersede nothing.

I only ever supersede an id from that block, and only from the same scope I am writing to. What I supersede is not deleted; it is kept with a note that this new fact replaced it, so I can be wrong about this and lose nothing.

I call memory-observe once, with facts: an entry for every fact I keep, in the order I found them. A turn that established nothing calls nothing at all. Each entry carries:
- scope, which decides how long the fact lives:
         "project" — durable and specific to this codebase: architecture, tooling, conventions, decisions. It reaches every future session here.
         "user" — a preference that follows the person across projects, and reaches every session anywhere.
         "session" — true only while this work is open: in-progress state, a temporary constraint, a working assumption. It dies with the session, so it is where I put what I doubt will outlive today — never where I file something that failed the bar above.
         A project-scoped preference is "project", not "user". Unsure is "session".
- content: the fact, keeping the specifics that make it usable — paths, names, figures and their units, error text, the reasoning behind a decision.
- topic: one lowercase word, when one fits (testing, auth, config, tooling).
- supersedes: the ids this fact replaces, when it replaces any. Omitted otherwise.`;

export type DistillObservation = {
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

export function parseObservationToolCall(call: Pick<LanguageModelV4ToolCall, "input">): DistillObservation[] {
  try {
    const parsed = DISTILL_OUTPUT_SCHEMA.safeParse(JSON.parse(call.input));
    if (!parsed.success) return [];
    return parsed.data.facts.map(({ scope, content, topic, supersedes }) => ({
      scope,
      content,
      topic: topic?.trim() ? topic.trim().toLowerCase() : null,
      supersedes: [...new Set(supersedes.map((id) => id.trim()).filter(Boolean))],
    }));
  } catch {
    return [];
  }
}

export async function defaultRunner(
  systemPrompt: string,
  userContent: string,
  model: string,
): Promise<DistillObservation[]> {
  const qualifiedModel = normalizeModel(model);
  const limiter = sharedRateLimiter(providerFromModel(qualifiedModel));
  const client = createModel(qualifiedModel, limiter);
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
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.type === "error") throw value.error instanceof Error ? value.error : new Error(String(value.error));
    if (value.type !== "tool-call" || value.toolName !== OBSERVE_FUNCTION_NAME) continue;
    observations.push(...parseObservationToolCall(value));
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
