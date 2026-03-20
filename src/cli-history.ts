import { formatRelativeTime } from "./chat-format";
import { hasBoolFlag, stripFlag } from "./cli-args";
import { type CliOutput, createJsonOutput, createTextOutput } from "./cli-output";
import { truncateText } from "./compact-text";
import { t } from "./i18n";
import type { readStore as readStoreType } from "./storage";

type HistoryModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  printDim: (message: string) => void;
  readStore: typeof readStoreType;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
};

export async function historyMode(args: string[], deps: HistoryModeDeps): Promise<void> {
  const { hasHelpFlag, printDim, readStore, commandError, commandHelp } = deps;
  if (hasHelpFlag(args)) {
    commandHelp("history");
    return;
  }
  const json = hasBoolFlag(args, "--json");
  const rest = stripFlag(args, "--json");
  if (rest.length > 0) {
    commandError("history");
    return;
  }
  const store = await readStore();
  if (store.sessions.length === 0) {
    printDim(t("chat.picker.sessions.none"));
    return;
  }

  const out: CliOutput = json ? createJsonOutput() : createTextOutput();
  out.addTable(
    store.sessions.slice(0, 20).map((session) => ({
      id: session.id,
      title: truncateText(session.title, 60),
      time: formatRelativeTime(session.updatedAt),
    })),
  );
  const rendered = out.render();
  if (rendered) printDim(rendered);
}
