import { type ChatRow, createRow } from "./chat-contract";
import { alignCols } from "./chat-format";
import { formatRelativeTime } from "./datetime";
import { t } from "./i18n";
import type { SessionState } from "./session-contract";

export function formatSessionList(sessionState: SessionState, limit = 10): string[] {
  const rows = sessionState.sessions.slice(0, limit).map((item) => {
    const active = item.id === sessionState.activeSessionId ? "●" : " ";
    const title = item.title || t("chat.session.default_title");
    return [`${active} ${item.id}`, title, formatRelativeTime(item.updatedAt)];
  });
  return alignCols(rows);
}

export function sessionsRows(sessionState: SessionState, limit = 10): ChatRow[] {
  const list = formatSessionList(sessionState, limit);
  return [
    createRow("system", {
      header: t("chat.sessions.header", { count: sessionState.sessions.length }),
      sections: [],
      list,
    }),
  ];
}
