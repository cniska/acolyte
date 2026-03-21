import { hasBoolFlag, parseFlag, parseTailCount } from "./cli-args";
import { createJsonOutput, createTextOutput } from "./cli-output";
import { parseSince } from "./datetime";
import { t } from "./i18n";
import { logLevelSchema } from "./log";
import { type LogLine, parseLog } from "./log-parser";

type LogsModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  logPath: string;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
};

function filterLines(lines: LogLine[], opts: { level?: string; session?: string; since?: Date }): LogLine[] {
  return lines.filter((line) => {
    if (opts.level && line.fields.level !== opts.level) return false;
    if (opts.session && line.fields.session_id !== opts.session) return false;
    if (opts.since && line.timestamp) {
      const ts = new Date(line.timestamp);
      if (ts < opts.since) return false;
    }
    return true;
  });
}

function formatLogLine(line: LogLine): Record<string, string | undefined> {
  return {
    timestamp: line.timestamp,
    level: line.fields.level,
    msg: line.fields.msg,
    event: line.fields.event,
    task_id: line.taskId,
    session_id: line.fields.session_id,
  };
}

export async function logsMode(args: string[], deps: LogsModeDeps): Promise<void> {
  const { hasHelpFlag, logPath, printDim, printError, readFile, commandHelp, commandError } = deps;

  if (hasHelpFlag(args)) {
    commandHelp("logs");
    return;
  }

  const tailCount = parseTailCount(parseFlag(args, ["--lines", "-n"]));
  const levelRaw = parseFlag(args, "--level");
  const session = parseFlag(args, "--session");
  const sinceRaw = parseFlag(args, "--since");
  const isJson = hasBoolFlag(args, "--json");

  if (levelRaw) {
    const parsed = logLevelSchema.safeParse(levelRaw);
    if (!parsed.success) {
      commandError("logs", t("cli.logs.invalid_level", { level: levelRaw }));
      return;
    }
  }

  let since: Date | undefined;
  if (sinceRaw) {
    since = parseSince(sinceRaw);
    if (!since) {
      commandError("logs", t("cli.logs.invalid_since", { value: sinceRaw }));
      return;
    }
  }

  let raw: string;
  try {
    raw = await readFile(logPath, "utf8");
  } catch {
    printError(t("cli.logs.no_file"));
    return;
  }

  const allLines = parseLog(raw);
  const filtered = filterLines(allLines, { level: levelRaw, session, since });
  const tailed = filtered.slice(-tailCount);

  if (tailed.length === 0) {
    printDim(t("cli.logs.no_lines"));
    return;
  }

  const out = isJson ? createJsonOutput() : createTextOutput();
  for (const line of tailed) out.addRow(formatLogLine(line));

  const rendered = out.render();
  if (rendered) printDim(rendered);
}
