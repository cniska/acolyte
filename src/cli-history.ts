import { hasBoolFlag, stripFlag } from "./cli-args";
import { type CliOutput, createJsonOutput, createTextOutput } from "./cli-output";
import { formatRelativeTime } from "./datetime";
import { t } from "./i18n";
import type { SessionStore } from "./session-contract";
import { truncateText } from "./truncate-text";

type HistoryModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  printDim: (message: string) => void;
  getSessionStore: () => Promise<SessionStore>;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
};

export async function historyMode(args: string[], deps: HistoryModeDeps): Promise<void> {
  const { hasHelpFlag, printDim, getSessionStore, commandError, commandHelp } = deps;
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
  const store = await getSessionStore();
  const sessions = await store.listSessions({ limit: 20 });
  if (sessions.length === 0) {
    printDim(t("chat.picker.sessions.none"));
    return;
  }

  const out: CliOutput = json ? createJsonOutput() : createTextOutput();
  out.addTable(
    sessions.map((session) => ({
      id: session.id,
      title: truncateText(session.title, 60),
      time: formatRelativeTime(session.updatedAt),
    })),
  );
  const rendered = out.render();
  if (rendered) printDim(rendered);
}
