import type { Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DistillScope } from "./distill-ops";
import { gitCommitsSince } from "./git-ops";
import { consumedExchanges, type ImportLedger, markConsumed } from "./import-ledger";
import { defaultMemoryPolicy, type MemoryDistiller, type MemoryPolicy } from "./memory-contract";
import { estimateDistillPromptTokens } from "./memory-distiller";
import { dataDir, type Env, resolveHomeDir } from "./paths";
import { projectLabelFromWorkspace } from "./resource-id";
import { parseClaudeCodeTranscript, type TranscriptExchange } from "./transcript-claude-code";

export const CLAUDE_CODE_SOURCE = "claude-code";

/**
 * A session-scoped observation is one the distiller judged true only while that work is open, and
 * the work an import reads is already over: nothing will resume the source session, so such a
 * record could never be recalled. An import keeps what the distiller marked as outliving a session.
 */
export const IMPORT_COMMIT_SCOPES: readonly DistillScope[] = ["project", "user"];

export function claudeCodeTranscriptDir(env: Env = process.env): string {
  return join(resolveHomeDir(env), ".claude", "projects");
}

/** Where an import puts what it distills: beside the real corpus, never in it. */
export function importScratchDir(env: Env = process.env): string {
  return join(dataDir(env), "import-scratch");
}

export type TranscriptSourceFile = { readonly path: string; readonly modifiedAt: Date };

export type ImportReader = {
  listTranscripts: (dir: string, since: Date) => Promise<TranscriptSourceFile[]>;
  readTranscript: (path: string) => Promise<string>;
};

// Gone between listing and stat is a file the run has no claim on; anything else must surface.
async function statOrMissing(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * The window selects whole session files by last activity, so a session still open at the boundary
 * arrives complete rather than clipped, and the ledger is what keeps its earlier half from being
 * distilled twice.
 */
async function listTranscripts(dir: string, since: Date): Promise<TranscriptSourceFile[]> {
  let names: string[];
  try {
    names = await readdir(dir, { recursive: true });
  } catch (error) {
    // No such directory is the source agent never having run here; anything else the caller must see.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return [];
  }
  const files: TranscriptSourceFile[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(dir, name);
    const info = await statOrMissing(path);
    if (!info?.isFile() || info.mtime < since) continue;
    files.push({ path, modifiedAt: info.mtime });
  }
  return files.sort((a, b) => a.modifiedAt.getTime() - b.modifiedAt.getTime());
}

export const fileImportReader: ImportReader = {
  listTranscripts,
  readTranscript: (path) => readFile(path, "utf8"),
};

/** The source session's own id is not a valid scope key, so its replay gets a stable derived one. */
export function importedSessionId(source: string, sourceSessionId: string): string {
  const hasher = new Bun.CryptoHasher("sha1");
  hasher.update(`${source}:${sourceSessionId}`);
  return `sess_${hasher.digest("hex").slice(0, 12)}`;
}

/**
 * Commits a project may accrue past a session before its tape stops earning what distilling it
 * costs. Not a claim about truth: chronological replay and write-time supersession own correctness,
 * and this bounds where the turn budget is spent. The starting value is the gap in the measured
 * distribution of a real machine's corpora, between live projects and abandoned ones.
 */
export const DEFAULT_STALENESS_BUDGET = 50;

export type ImportSessionPlan = {
  readonly sourceSessionId: string;
  readonly path: string;
  readonly sessionId: string;
  readonly workspace: string | null;
  readonly project: string;
  readonly lastActivityAt: string | null;
  readonly movement: number | null;
  readonly stale: boolean;
  readonly exchanges: readonly TranscriptExchange[];
  readonly consumed: number;
  readonly pending: number;
  readonly calls: number;
  readonly estimatedTokens: number;
};

/** A session the staleness budget kept out of the run, reported so the exclusion is never silent. */
export type StaleSessionRef = {
  readonly sourceSessionId: string;
  readonly lastActivityAt: string | null;
  readonly movement: number | null;
};

function sessionIdFromPath(path: string): string {
  return (
    path
      .split("/")
      .pop()
      ?.replace(/\.jsonl$/, "") ?? path
  );
}

/**
 * The distill calls the pending turns will make and the prompt tokens they will spend. Fewer calls
 * than turns: a session's opening turns carry too little history to distill. The token figure is a
 * floor, the same one `lifecycle.ts` reports — it omits the recall candidates each call is shown,
 * whose size is known only once the commit runs, and whose per-call ceiling the policy sets.
 */
function estimatePending(
  exchanges: readonly TranscriptExchange[],
  consumed: number,
  policy: MemoryPolicy,
): { calls: number; tokens: number } {
  const messages: { role: string; content: string }[] = [];
  let calls = 0;
  let tokens = 0;
  for (const [index, exchange] of exchanges.entries()) {
    messages.push({ role: "user", content: exchange.prompt });
    if (index >= consumed && messages.length >= policy.messageThreshold) {
      calls++;
      tokens += estimateDistillPromptTokens(
        messages.slice(-policy.contextMessageWindow),
        exchange.response,
        exchange.activity,
      );
    }
    messages.push({ role: "assistant", content: exchange.response });
  }
  return { calls, tokens };
}

/** The `owner/repo` a recorded working directory belongs to, which is what keys its project scope. */
export type ProjectResolver = (workspace: string) => string | null;

/** Commits the checkout accrued after a moment, which is how far it has moved past a session. */
export type MovementCounter = (sinceIso: string) => Promise<number>;

export type PlanImportOptions = {
  dir: string;
  since: Date;
  workspace: string;
  project: string;
  ledger: ImportLedger;
  maxTurns?: number;
  includeStale?: boolean;
  stalenessBudget?: number;
  reader?: ImportReader;
  resolveProject?: ProjectResolver;
  countCommitsSince?: MovementCounter;
  policy?: MemoryPolicy;
};

export type ImportPlan = {
  readonly sessions: readonly ImportSessionPlan[];
  readonly heldBack: number;
  readonly stale: readonly StaleSessionRef[];
  readonly unattributable: number;
};

type ImportCandidate = {
  readonly file: TranscriptSourceFile;
  readonly sourceSessionId: string;
  readonly workspace: string | null;
  readonly project: string | null;
  readonly lastActivityAt: string | null;
  readonly orderedAt: number;
  readonly exchanges: readonly TranscriptExchange[];
};

/**
 * When the session happened, which is what the timeline orders by. A file's mtime is only the last
 * time its bytes were touched — copying or restoring a transcript makes it lie — so it stands in
 * only for a session whose records carry no timestamp of their own.
 */
function orderingKey(lastActivityAt: string | null, file: TranscriptSourceFile): number {
  const parsed = lastActivityAt ? Date.parse(lastActivityAt) : Number.NaN;
  return Number.isNaN(parsed) ? file.modifiedAt.getTime() : parsed;
}

/** Picks the recorded directory that names this run's project, falling back to the first. */
function attribute(
  workspaces: readonly string[],
  project: string,
  resolveProject: ProjectResolver,
): { workspace: string | null; project: string | null } {
  for (const workspace of workspaces) {
    if (resolveProject(workspace) === project) return { workspace, project };
  }
  const first = workspaces[0] ?? null;
  return { workspace: first, project: first ? resolveProject(first) : null };
}

async function readCandidates(
  options: PlanImportOptions,
  reader: ImportReader,
  resolveProject: ProjectResolver,
): Promise<ImportCandidate[]> {
  const candidates: ImportCandidate[] = [];
  for (const file of await reader.listTranscripts(options.dir, options.since)) {
    const transcript = parseClaudeCodeTranscript(await reader.readTranscript(file.path));
    if (transcript.exchanges.length === 0) continue;
    candidates.push({
      file,
      sourceSessionId: transcript.sessionId ?? sessionIdFromPath(file.path),
      ...attribute(transcript.workspaces, options.project, resolveProject),
      lastActivityAt: transcript.lastActivityAt,
      orderedAt: orderingKey(transcript.lastActivityAt, file),
      exchanges: transcript.exchanges,
    });
  }
  return candidates;
}

/**
 * Reads the transcripts in the window and says what a run would distill.
 *
 * The run imports one project: the one the command stands in. Each session names its project by the
 * checkout it recorded working in, resolved now rather than trusted as a path — the recorded
 * directory may be gone, and Acolyte keys a project by its repository remote, so sessions from any
 * other checkout or worktree of the same repository belong to this run too.
 *
 * Sessions then merge onto one timeline, oldest first, and the budget is spent from the old end.
 * That ordering is forced rather than preferred: the ledger makes a run resumable, so a later run
 * replays what an earlier one held back, and spending newest-first would let those older turns
 * arrive after newer facts were already stored and supersede them backward.
 *
 * `maxTurns` bounds the run by cutting each session's tail rather than dropping whole sessions, so
 * the turns that are taken still replay in order and the ledger records exactly how far each got.
 */
export async function planImport(options: PlanImportOptions): Promise<ImportPlan> {
  const reader = options.reader ?? fileImportReader;
  const resolveProject = options.resolveProject ?? projectLabelFromWorkspace;
  const countCommitsSince = options.countCommitsSince ?? ((iso) => gitCommitsSince(options.workspace, iso));
  const policy = options.policy ?? defaultMemoryPolicy;
  const budgetLimit = options.stalenessBudget ?? DEFAULT_STALENESS_BUDGET;

  const candidates = await readCandidates(options, reader, resolveProject);
  const mine = candidates.filter((candidate) => candidate.project === options.project);
  const unattributable = candidates.filter((candidate) => candidate.project === null).length;

  const movements = new Map<string, number>();
  const measure = async (lastActivityAt: string | null): Promise<number | null> => {
    if (!lastActivityAt) return null;
    const cached = movements.get(lastActivityAt);
    if (cached !== undefined) return cached;
    const counted = await countCommitsSince(lastActivityAt);
    movements.set(lastActivityAt, counted);
    return counted;
  };

  const sessions: ImportSessionPlan[] = [];
  const stale: StaleSessionRef[] = [];
  let budget = options.maxTurns ?? Number.POSITIVE_INFINITY;
  let heldBack = 0;

  for (const candidate of mine.sort((a, b) => a.orderedAt - b.orderedAt)) {
    const movement = await measure(candidate.lastActivityAt);
    // An unmeasurable session fails the gate closed: the timestamp its records carry is optional,
    // and without one there is no telling what the project did after it.
    const isStale = movement === null || movement > budgetLimit;
    if (isStale && options.includeStale !== true) {
      stale.push({
        sourceSessionId: candidate.sourceSessionId,
        lastActivityAt: candidate.lastActivityAt,
        movement,
      });
      continue;
    }
    const consumed = consumedExchanges(options.ledger, CLAUDE_CODE_SOURCE, candidate.sourceSessionId);
    const available = Math.max(candidate.exchanges.length - consumed, 0);
    const taken = Math.min(available, budget);
    budget -= taken;
    heldBack += available - taken;
    const exchanges = candidate.exchanges.slice(0, consumed + taken);
    const estimate = estimatePending(exchanges, consumed, policy);
    sessions.push({
      sourceSessionId: candidate.sourceSessionId,
      path: candidate.file.path,
      sessionId: importedSessionId(CLAUDE_CODE_SOURCE, candidate.sourceSessionId),
      workspace: candidate.workspace,
      project: options.project,
      lastActivityAt: candidate.lastActivityAt,
      movement,
      stale: isStale,
      exchanges,
      consumed,
      pending: taken,
      calls: estimate.calls,
      estimatedTokens: estimate.tokens,
    });
  }
  return { sessions, heldBack, stale, unattributable };
}

export type ImportSessionResult = {
  readonly plan: ImportSessionPlan;
  readonly distilled: number;
  readonly facts: number;
  readonly superseded: number;
  readonly tokens: number;
};

/**
 * Replays one session as the sequence of turns that produced it, so the distiller sees the same
 * growing history a live session gives it and decides for itself what survives each turn.
 */
export async function importSession(
  plan: ImportSessionPlan,
  distiller: MemoryDistiller,
  model: string,
  onTurn?: (consumedThrough: number) => Promise<void>,
): Promise<ImportSessionResult> {
  const messages: { role: string; content: string }[] = [];
  let distilled = 0;
  let facts = 0;
  let superseded = 0;
  let tokens = 0;

  for (const [index, exchange] of plan.exchanges.entries()) {
    messages.push({ role: "user", content: exchange.prompt });
    if (index >= plan.consumed) {
      const metrics = await distiller.commit({
        model,
        sessionId: plan.sessionId,
        workspace: plan.workspace ?? undefined,
        messages: [...messages],
        output: exchange.response,
        activity: exchange.activity,
      });
      if (metrics) {
        distilled++;
        facts +=
          (metrics.projectPromotedFacts ?? 0) + (metrics.userPromotedFacts ?? 0) + (metrics.sessionScopedFacts ?? 0);
        superseded += metrics.supersededFacts ?? 0;
        tokens += metrics.distillTokens ?? 0;
      }
    }
    messages.push({ role: "assistant", content: exchange.response });
    if (index >= plan.consumed) await onTurn?.(index + 1);
  }

  return { plan, distilled, facts, superseded, tokens };
}

export type RunImportOptions = {
  plans: readonly ImportSessionPlan[];
  distiller: MemoryDistiller;
  model: string;
  ledger: ImportLedger;
  saveLedger: (ledger: ImportLedger) => Promise<void>;
};

/**
 * Imports each planned session, recording progress after every turn. The unit is the turn rather
 * than the session because a run is interrupted mid-session in practice, and a turn whose facts are
 * already stored must never be paid for twice.
 */
export async function runImport(options: RunImportOptions): Promise<ImportSessionResult[]> {
  const results: ImportSessionResult[] = [];
  let ledger = options.ledger;

  for (const plan of options.plans) {
    if (plan.pending === 0) continue;
    const result = await importSession(plan, options.distiller, options.model, async (through) => {
      ledger = markConsumed(ledger, CLAUDE_CODE_SOURCE, plan.sourceSessionId, through);
      await options.saveLedger(ledger);
    });
    results.push(result);
  }
  return results;
}
