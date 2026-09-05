import { join } from "node:path";
import { hasBoolFlag, parseFlag, parsePositional } from "./cli-args";
import { type CliOutput, createJsonOutput, createTextOutput } from "./cli-output";
import { parseSince } from "./datetime";
import { t } from "./i18n";
import type { ImportLedger } from "./import-ledger";
import { defaultMemoryPolicy, type MemoryDistiller, type MemoryStore } from "./memory-contract";
import { formatCompactNumber } from "./number-format";
import type { ImportPlan, ImportSessionPlan, ImportSessionResult, RunImportOptions } from "./transcript-import";

const DEFAULT_SINCE = "24h";
// A day of transcripts is hundreds of turns; the ledger makes a bounded first bite resumable rather
// than a partial import. Calls are fewer than turns: a session's opening turns are read for the
// context they give later ones, and the plan's own call count is what the token band is built on.
const DEFAULT_MAX_TURNS = 25;
const STORE_FILE = "memory.db";
const LEDGER_FILE = "ledger.json";

export type PlanImportRequest = {
  dir: string;
  since: Date;
  workspace: string;
  project: string;
  ledger: ImportLedger;
  maxTurns: number;
  includeStale: boolean;
};

/** The configured model as an import can use it: none chosen, chosen but without a credential, or runnable. */
export type ImportModelChoice =
  | { kind: "unconfigured" }
  | { kind: "unavailable"; model: string }
  | { kind: "ready"; model: string };

export type ImportModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  transcriptDir: string;
  scratchDir: string;
  workspace: string;
  project: string | null;
  planImport: (request: PlanImportRequest) => Promise<ImportPlan>;
  runImport: (options: RunImportOptions) => Promise<ImportSessionResult[]>;
  createStore: (path: string) => MemoryStore;
  createDistiller: (store: MemoryStore) => MemoryDistiller;
  resolveModel: () => ImportModelChoice;
  readLedger: (path: string) => Promise<ImportLedger>;
  writeLedger: (path: string, ledger: ImportLedger) => Promise<void>;
  removeDir: (path: string) => Promise<void>;
  printDim: (message: string) => void;
  printOutput: (message: string) => void;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
};

function shortId(sourceSessionId: string): string {
  return sourceSessionId.slice(0, 8);
}

function columnLabels(): Record<string, string> {
  return {
    session: t("cli.import.col.session"),
    project: t("cli.import.col.project"),
    turns: t("cli.import.col.turns"),
    memories: t("cli.import.col.memories"),
    replaced: t("cli.import.col.replaced"),
    tokens: t("cli.import.col.tokens"),
  };
}

function planRow(plan: ImportSessionPlan): Record<string, string> {
  return {
    session: shortId(plan.sourceSessionId),
    project: plan.project,
    turns: String(plan.pending),
    tokens: formatCompactNumber(plan.estimatedTokens),
  };
}

function resultRow(result: ImportSessionResult): Record<string, string> {
  return {
    session: shortId(result.plan.sourceSessionId),
    project: result.plan.project,
    memories: String(result.facts),
    replaced: String(result.superseded),
    tokens: formatCompactNumber(result.tokens),
  };
}

/**
 * What the run will spend, as the band between the floor each reading's own prompt costs and the
 * ceiling the memories it is shown for replacement can add. The floor alone reads as a total and is
 * not one; the policy caps that block per reading, which is what makes the ceiling computable.
 */
function tokenBand(sessions: readonly ImportSessionPlan[]): { count: number; low: string; high: string } {
  const calls = sessions.reduce((sum, session) => sum + session.calls, 0);
  const low = sessions.reduce((sum, session) => sum + session.estimatedTokens, 0);
  return {
    count: sessions.reduce((sum, session) => sum + session.pending, 0),
    low: formatCompactNumber(low),
    high: formatCompactNumber(low + calls * defaultMemoryPolicy.recallCandidateTokenLimit),
  };
}

/** What the window held but the run will not touch, each line naming how to reach it. */
function notices(plan: ImportPlan): string[] {
  const lines: string[] = [];
  const dated = plan.stale.filter((session) => session.movement !== null);
  const undated = plan.stale.length - dated.length;
  if (dated.length > 0) {
    const behind = Math.max(...dated.map((session) => session.movement ?? 0));
    lines.push(t("cli.import.stale", { count: dated.length, commits: behind }));
  }
  if (undated > 0) lines.push(t("cli.import.undated", { count: undated }));
  if (plan.unattributable > 0) lines.push(t("cli.import.unattributable", { count: plan.unattributable }));
  return lines;
}

function report(result: ImportSessionResult, json: boolean, deps: ImportModeDeps): void {
  if (json) {
    const out = createJsonOutput();
    out.addTable([resultRow(result)], columnLabels());
    const rendered = out.render();
    if (rendered) deps.printOutput(rendered);
    return;
  }
  deps.printDim(
    t("cli.import.session_done", {
      session: shortId(result.plan.sourceSessionId),
      project: result.plan.project,
      count: result.facts,
      superseded: result.superseded,
      tokens: formatCompactNumber(result.tokens),
    }),
  );
}

function emit(rows: Record<string, string>[], summary: string[], json: boolean, deps: ImportModeDeps): void {
  const out: CliOutput = json ? createJsonOutput() : createTextOutput();
  out.addTable(rows, columnLabels());
  if (!json) {
    out.addSeparator();
    for (const line of summary) out.addHeader(line);
  }
  const rendered = out.render();
  if (rendered) (json ? deps.printOutput : deps.printDim)(rendered);
}

/**
 * Distills a window of another agent's transcripts into a throwaway corpus. The source hands over
 * tapes and nothing else: every fact that lands was observed by Acolyte's own distiller.
 */
export async function importMode(args: string[], deps: ImportModeDeps): Promise<void> {
  if (deps.hasHelpFlag(args)) {
    deps.commandHelp("import");
    return;
  }
  if (parsePositional(args, ["--since", "--max-turns"]).length > 0) {
    deps.commandError("import");
    return;
  }

  const sinceRaw = parseFlag(args, "--since") ?? DEFAULT_SINCE;
  const since = parseSince(sinceRaw);
  if (!since) {
    deps.commandError("import", t("cli.args.invalid_since", { value: sinceRaw }));
    return;
  }
  const maxTurnsRaw = parseFlag(args, "--max-turns");
  const maxTurns = maxTurnsRaw === undefined ? DEFAULT_MAX_TURNS : Number(maxTurnsRaw);
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    deps.commandError("import", t("cli.import.invalid_max_turns", { value: maxTurnsRaw ?? "" }));
    return;
  }
  const json = hasBoolFlag(args, "--json");
  const dryRun = hasBoolFlag(args, "--dry-run");
  const includeStale = hasBoolFlag(args, "--include-stale");

  // A run imports the project it stands in, so a workspace that names none has nothing to import
  // and no repository to measure a session's staleness against.
  const project = deps.project;
  if (!project) {
    deps.commandError("import", t("cli.import.no_project"));
    return;
  }

  if (hasBoolFlag(args, "--reset")) {
    await deps.removeDir(deps.scratchDir);
    if (!json) deps.printDim(t("cli.import.reset", { path: deps.scratchDir }));
  }

  // Checked before anything is read: distillation is the only thing that turns a transcript into a
  // fact, so without a model to run it there is no import to attempt. A dry run makes no model
  // call, which is what makes it the thing to run before a provider is connected.
  const chosen = dryRun ? null : deps.resolveModel();
  if (chosen?.kind === "unconfigured") {
    deps.commandError("import", t("cli.model.not_configured"));
    return;
  }
  if (chosen?.kind === "unavailable") {
    deps.commandError("import", t("cli.import.no_model", { model: chosen.model }));
    return;
  }

  const ledgerPath = join(deps.scratchDir, LEDGER_FILE);
  const ledger = await deps.readLedger(ledgerPath);
  const plan = await deps.planImport({
    dir: deps.transcriptDir,
    since,
    workspace: deps.workspace,
    project,
    ledger,
    maxTurns,
    includeStale,
  });
  const pending = plan.sessions.filter((session) => session.pending > 0);
  const held = plan.heldBack > 0 ? [t("cli.import.held_back", { count: plan.heldBack })] : [];
  const skipped = notices(plan);

  if (pending.length === 0) {
    if (!json) {
      deps.printDim(t("cli.import.none", { since: sinceRaw, project }));
      for (const line of skipped) deps.printDim(line);
    }
    return;
  }

  const band = tokenBand(pending);
  const planSummary = [t("cli.import.plan", band), ...held, ...skipped];
  if (!chosen) {
    emit(pending.map(planRow), planSummary, json, deps);
    return;
  }
  if (!json) emit(pending.map(planRow), planSummary, false, deps);

  const store = deps.createStore(join(deps.scratchDir, STORE_FILE));
  try {
    const results = await deps.runImport({
      plans: pending,
      distiller: deps.createDistiller(store),
      model: chosen.model,
      ledger,
      saveLedger: (next) => deps.writeLedger(ledgerPath, next),
      onSession: (result) => report(result, json, deps),
    });
    const summary = t("cli.import.done", {
      count: results.reduce((sum, result) => sum + result.facts, 0),
      superseded: results.reduce((sum, result) => sum + result.superseded, 0),
      tokens: formatCompactNumber(results.reduce((sum, result) => sum + result.tokens, 0)),
      path: deps.scratchDir,
    });
    if (!json) deps.printDim(summary);
  } catch (error) {
    // The ledger holds every turn already paid for, so the run stops where it stands and says why.
    deps.commandError("import", error instanceof Error ? error.message : String(error));
  } finally {
    store.close();
  }
}
