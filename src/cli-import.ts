import { join } from "node:path";
import { hasBoolFlag, parseFlag, parsePositional } from "./cli-args";
import { formatUsage } from "./cli-help";
import { type CliOutput, createJsonOutput, createTextOutput } from "./cli-output";
import { parseSince } from "./datetime";
import { t } from "./i18n";
import type { ImportLedger } from "./import-ledger";
import type { MemoryDistiller, MemoryStore } from "./memory-contract";
import type { ImportPlan, ImportSessionPlan, ImportSessionResult, RunImportOptions } from "./transcript-import";

const DEFAULT_SINCE = "24h";
// One distill call per turn, so this is the run's model-call budget. A day of transcripts is
// hundreds of turns; the ledger makes a bounded first bite resumable rather than a partial import.
const DEFAULT_MAX_TURNS = 25;
const STORE_FILE = "memory.db";
const LEDGER_FILE = "ledger.json";

export type ImportModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  transcriptDir: string;
  scratchDir: string;
  planImport: (options: { dir: string; since: Date; ledger: ImportLedger; maxTurns: number }) => Promise<ImportPlan>;
  runImport: (options: RunImportOptions) => Promise<ImportSessionResult[]>;
  createStore: (path: string) => MemoryStore;
  createDistiller: (store: MemoryStore) => MemoryDistiller;
  resolveModel: () => { model: string; available: boolean };
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
    calls: t("cli.import.col.calls"),
    facts: t("cli.import.col.facts"),
    superseded: t("cli.import.col.superseded"),
    tokens: t("cli.import.col.tokens"),
  };
}

function planRow(plan: ImportSessionPlan): Record<string, string> {
  return {
    session: shortId(plan.sourceSessionId),
    project: plan.project ?? "-",
    turns: String(plan.pending),
    tokens: String(plan.estimatedTokens),
  };
}

function resultRow(result: ImportSessionResult): Record<string, string> {
  return {
    session: shortId(result.plan.sourceSessionId),
    project: result.plan.project ?? "-",
    calls: String(result.distilled),
    facts: String(result.facts),
    superseded: String(result.superseded),
    tokens: String(result.tokens),
  };
}

function emit(rows: Record<string, string>[], summary: string, json: boolean, deps: ImportModeDeps): void {
  const out: CliOutput = json ? createJsonOutput() : createTextOutput();
  out.addTable(rows, columnLabels());
  if (!json) {
    out.addSeparator();
    out.addHeader(summary);
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
  const usage = formatUsage("acolyte import [--since <duration>] [--max-turns <n>] [--dry-run] [--reset] [--json]");
  if (parsePositional(args, ["--since", "--max-turns"]).length > 0) {
    deps.commandError("import", usage);
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

  // Checked before anything is cleared or read: distillation is the only thing that turns a
  // transcript into a fact, so without a model to run it there is no import to attempt. A dry run
  // makes no model call, which is what makes it the thing to run before a provider is connected.
  const chosen = deps.resolveModel();
  if (!dryRun && !chosen.available) {
    deps.commandError("import", t("cli.import.no_model", { model: chosen.model }));
    return;
  }

  if (hasBoolFlag(args, "--reset")) {
    await deps.removeDir(deps.scratchDir);
    if (!json) deps.printDim(t("cli.import.reset", { path: deps.scratchDir }));
  }

  const ledgerPath = join(deps.scratchDir, LEDGER_FILE);
  const ledger = await deps.readLedger(ledgerPath);
  const plan = await deps.planImport({ dir: deps.transcriptDir, since, ledger, maxTurns });
  const pending = plan.sessions.filter((session) => session.pending > 0);
  const heldBack = plan.heldBack > 0 ? ` ${t("cli.import.held_back", { count: plan.heldBack })}` : "";

  if (pending.length === 0) {
    if (!json) deps.printDim(t("cli.import.none", { since: sinceRaw }));
    return;
  }

  if (dryRun) {
    const summary = t("cli.import.plan", {
      count: pending.reduce((sum, session) => sum + session.pending, 0),
      tokens: pending.reduce((sum, session) => sum + session.estimatedTokens, 0),
    });
    emit(pending.map(planRow), summary + heldBack, json, deps);
    return;
  }

  const store = deps.createStore(join(deps.scratchDir, STORE_FILE));
  try {
    const results = await deps.runImport({
      plans: pending,
      distiller: deps.createDistiller(store),
      model: chosen.model,
      ledger,
      saveLedger: (next) => deps.writeLedger(ledgerPath, next),
    });
    const summary = t("cli.import.done", {
      count: results.reduce((sum, result) => sum + result.facts, 0),
      superseded: results.reduce((sum, result) => sum + result.superseded, 0),
      tokens: results.reduce((sum, result) => sum + result.tokens, 0),
      path: deps.scratchDir,
    });
    emit(results.map(resultRow), summary + heldBack, json, deps);
  } finally {
    store.close();
  }
}
