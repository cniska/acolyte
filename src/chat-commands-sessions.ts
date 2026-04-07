import { type ChatRow, createRow } from "./chat-contract";
import { alignCols } from "./chat-format";
import { formatRelativeTime } from "./datetime";
import { t } from "./i18n";
import type { SessionState } from "./session-contract";

export function formatSessionList(store: SessionState, limit = 10): string[] {
  const rows = store.sessions.slice(0, limit).map((item) => {
    const active = item.id === store.activeSessionId ? "●" : " ";
    const title = item.title || t("chat.session.default_title");
    return [`${active} ${item.id}`, title, formatRelativeTime(item.updatedAt)];
  });
  return alignCols(rows);
}

export function sessionsRows(store: SessionState, limit = 10): ChatRow[] {
  const list = formatSessionList(store, limit);
  return [
    createRow("system", { header: t("chat.sessions.header", { count: store.sessions.length }), sections: [], list }),
  ];
}
