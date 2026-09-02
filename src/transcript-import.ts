import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DistillScope } from "./distill-ops";
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
    const info = await stat(path).catch(() => null);
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

export type ImportSessionPlan = {
  readonly sourceSessionId: string;
  readonly path: string;
  readonly sessionId: string;
  readonly workspace: string | null;
  readonly project: string | null;
  readonly exchanges: readonly TranscriptExchange[];
  readonly consumed: number;
  readonly pending: number;
  readonly estimatedTokens: number;
};

function sessionIdFromPath(path: string): string {
  return (
    path
      .split("/")
      .pop()
      ?.replace(/\.jsonl$/, "") ?? path
  );
}

// A floor, the same one `lifecycle.ts` reports: it covers one window per exchange and omits the
// recall candidates the distiller is shown, whose size is known only once the commit runs.
function estimatePendingTokens(
  exchanges: readonly TranscriptExchange[],
  consumed: number,
  policy: MemoryPolicy,
): number {
  const messages: { role: string; content: string }[] = [];
  let total = 0;
  for (const [index, exchange] of exchanges.entries()) {
    messages.push({ role: "user", content: exchange.prompt });
    if (index >= consumed && messages.length >= policy.messageThreshold) {
      total += estimateDistillPromptTokens(
        messages.slice(-policy.contextMessageWindow),
        exchange.response,
        exchange.activity,
      );
    }
    messages.push({ role: "assistant", content: exchange.response });
  }
  return total;
}

/** The `owner/repo` a recorded working directory belongs to, which is what keys its project scope. */
export type ProjectResolver = (workspace: string) => string | null;

export type PlanImportOptions = {
  dir: string;
  since: Date;
  ledger: ImportLedger;
  maxTurns?: number;
  reader?: ImportReader;
  resolveProject?: ProjectResolver;
  policy?: MemoryPolicy;
};

export type ImportPlan = {
  readonly sessions: readonly ImportSessionPlan[];
  readonly heldBack: number;
};

/**
 * Reads the transcripts in the window and says what a run would distill. Project scope comes from
 * the checkout each session recorded working in, resolved now: the source names a project by a path
 * that may no longer exist, and Acolyte keys one by its repository remote.
 *
 * `maxTurns` bounds the run by cutting each session's tail rather than dropping whole sessions, so
 * the turns that are taken still replay in order and the ledger records exactly how far each got.
 */
export async function planImport(options: PlanImportOptions): Promise<ImportPlan> {
  const reader = options.reader ?? fileImportReader;
  const resolveProject = options.resolveProject ?? projectLabelFromWorkspace;
  const policy = options.policy ?? defaultMemoryPolicy;
  const files = await reader.listTranscripts(options.dir, options.since);
  const sessions: ImportSessionPlan[] = [];
  let budget = options.maxTurns ?? Number.POSITIVE_INFINITY;
  let heldBack = 0;

  for (const file of files) {
    const transcript = parseClaudeCodeTranscript(await reader.readTranscript(file.path));
    if (transcript.exchanges.length === 0) continue;
    const sourceSessionId = transcript.sessionId ?? sessionIdFromPath(file.path);
    const consumed = consumedExchanges(options.ledger, CLAUDE_CODE_SOURCE, sourceSessionId);
    const workspace = transcript.workspace;
    const available = Math.max(transcript.exchanges.length - consumed, 0);
    const taken = Math.min(available, budget);
    budget -= taken;
    heldBack += available - taken;
    const exchanges = transcript.exchanges.slice(0, consumed + taken);
    sessions.push({
      sourceSessionId,
      path: file.path,
      sessionId: importedSessionId(CLAUDE_CODE_SOURCE, sourceSessionId),
      workspace,
      project: workspace ? resolveProject(workspace) : null,
      exchanges,
      consumed,
      pending: taken,
      estimatedTokens: estimatePendingTokens(exchanges, consumed, policy),
    });
  }
  return { sessions, heldBack };
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
export async function importSession(plan: ImportSessionPlan, distiller: MemoryDistiller): Promise<ImportSessionResult> {
  const messages: { role: string; content: string }[] = [];
  let distilled = 0;
  let facts = 0;
  let superseded = 0;
  let tokens = 0;

  for (const [index, exchange] of plan.exchanges.entries()) {
    messages.push({ role: "user", content: exchange.prompt });
    if (index >= plan.consumed) {
      const metrics = await distiller.commit({
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
  }

  return { plan, distilled, facts, superseded, tokens };
}

export type RunImportOptions = {
  plans: readonly ImportSessionPlan[];
  distiller: MemoryDistiller;
  ledger: ImportLedger;
  saveLedger: (ledger: ImportLedger) => Promise<void>;
  onSession?: (result: ImportSessionResult) => void;
};

/**
 * Imports each planned session and records it consumed before moving on, so an interrupted run
 * resumes where it stopped instead of re-distilling what it already wrote.
 */
export async function runImport(options: RunImportOptions): Promise<ImportSessionResult[]> {
  const results: ImportSessionResult[] = [];
  let ledger = options.ledger;

  for (const plan of options.plans) {
    if (plan.pending === 0) continue;
    const result = await importSession(plan, options.distiller);
    ledger = markConsumed(ledger, CLAUDE_CODE_SOURCE, plan.sourceSessionId, plan.exchanges.length);
    await options.saveLedger(ledger);
    options.onSession?.(result);
    results.push(result);
  }
  return results;
}
