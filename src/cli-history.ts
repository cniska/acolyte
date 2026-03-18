import { alignCols, formatRelativeTime } from "./chat-format";
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

function listSessions(store: Awaited<ReturnType<typeof readStoreType>>, printDim: (message: string) => void): void {
  if (store.sessions.length === 0) {
    printDim(t("chat.picker.sessions.none"));
    return;
  }

  const rows = store.sessions
    .slice(0, 20)
    .map((session) => [session.id, truncateText(session.title, 60), formatRelativeTime(session.updatedAt)]);
  for (const line of alignCols(rows)) {
    printDim(line);
  }
}

export async function historyMode(args: string[], deps: HistoryModeDeps): Promise<void> {
  const { hasHelpFlag, printDim, readStore, commandError, commandHelp } = deps;
  if (hasHelpFlag(args)) {
    commandHelp("history");
    return;
  }
  if (args.length > 0) {
    commandError("history");
    return;
  }
  const store = await readStore();
  listSessions(store, printDim);
}
