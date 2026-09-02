import { join } from "node:path";
import { hasBoolFlag, parseFlag, parsePositional } from "./cli-args";
import { formatUsage } from "./cli-help";
import { type CliOutput, createJsonOutput, createTextOutput } from "./cli-output";
import { parseSince } from "./datetime";
import { t } from "./i18n";
import type { ImportLedger } from "./import-ledger";
import type { MemoryDistiller, MemoryStore } from "./memory-contract";
import type { ImportSessionPlan, ImportSessionResult, RunImportOptions } from "./transcript-import";

const DEFAULT_SINCE = "24h";
const STORE_FILE = "memory.db";
const LEDGER_FILE = "ledger.json";

export type ImportModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  transcriptDir: string;
  scratchDir: string;
  planImport: (options: { dir: string; since: Date; ledger: ImportLedger }) => Promise<ImportSessionPlan[]>;
  runImport: (options: RunImportOptions) => Promise<ImportSessionResult[]>;
  createStore: (path: string) => MemoryStore;
  createDistiller: (store: MemoryStore) => MemoryDistiller;
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
    turns: String(result.distilled),
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
  const usage = formatUsage("acolyte import [--since <duration>] [--dry-run] [--reset] [--json]");
  if (parsePositional(args, ["--since"]).length > 0) {
    deps.commandError("import", usage);
    return;
  }

  const sinceRaw = parseFlag(args, "--since") ?? DEFAULT_SINCE;
  const since = parseSince(sinceRaw);
  if (!since) {
    deps.commandError("import", t("cli.args.invalid_since", { value: sinceRaw }));
    return;
  }
  const json = hasBoolFlag(args, "--json");
  const dryRun = hasBoolFlag(args, "--dry-run");

  if (hasBoolFlag(args, "--reset")) {
    await deps.removeDir(deps.scratchDir);
    if (!json) deps.printDim(t("cli.import.reset", { path: deps.scratchDir }));
  }

  const ledgerPath = join(deps.scratchDir, LEDGER_FILE);
  const ledger = await deps.readLedger(ledgerPath);
  const plans = await deps.planImport({ dir: deps.transcriptDir, since, ledger });
  const pending = plans.filter((plan) => plan.pending > 0);

  if (pending.length === 0) {
    if (!json) deps.printDim(t("cli.import.none", { since: sinceRaw }));
    return;
  }

  if (dryRun) {
    const summary = t("cli.import.plan", {
      sessions: pending.length,
      exchanges: pending.reduce((sum, plan) => sum + plan.pending, 0),
      tokens: pending.reduce((sum, plan) => sum + plan.estimatedTokens, 0),
    });
    emit(pending.map(planRow), summary, json, deps);
    return;
  }

  const store = deps.createStore(join(deps.scratchDir, STORE_FILE));
  try {
    const results = await deps.runImport({
      plans: pending,
      distiller: deps.createDistiller(store),
      ledger,
      saveLedger: (next) => deps.writeLedger(ledgerPath, next),
    });
    const summary = t("cli.import.done", {
      sessions: results.length,
      facts: results.reduce((sum, result) => sum + result.facts, 0),
      superseded: results.reduce((sum, result) => sum + result.superseded, 0),
      tokens: results.reduce((sum, result) => sum + result.tokens, 0),
      path: deps.scratchDir,
    });
    emit(results.map(resultRow), summary, json, deps);
  } finally {
    store.close();
  }
}
