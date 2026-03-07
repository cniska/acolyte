import { type ChatRow, createRow } from "./chat-commands";
import type { Client } from "./client";
import { t } from "./i18n";

type SetRows = (updater: (current: ChatRow[]) => ChatRow[]) => void;

type StartRemoteTaskFollowupInput = {
  client: Client;
  remoteTaskId: string;
  setRows: SetRows;
  setProgressText: (next: string | null) => void;
  persist: () => Promise<void>;
  stopWorking: () => void;
};

export async function startRemoteTaskFollowup(input: StartRemoteTaskFollowupInput): Promise<boolean> {
  try {
    const task = await input.client.taskStatus(input.remoteTaskId);
    if (!task || (task.state !== "running" && task.state !== "detached")) return false;
  } catch {
    return false;
  }

  input.setProgressText(t("chat.task.followup.still_running"));
  void (async () => {
    try {
      for (let pollCount = 0; pollCount < 300; pollCount += 1) {
        await Bun.sleep(700);
        const next = await input.client.taskStatus(input.remoteTaskId);
        if (!next || next.state === "running" || next.state === "detached") continue;
        if (next.state === "failed") {
          const detail = next.summary?.trim() || t("chat.task.followup.failed");
          input.setRows((current) => [...current, createRow("system", detail, { dim: true, style: "error" })]);
        } else if (next.state === "cancelled") {
          const detail = next.summary?.trim() || t("chat.task.followup.cancelled");
          input.setRows((current) => [...current, createRow("system", detail, { dim: true, style: "cancelled" })]);
        }
        await input.persist();
        return;
      }
      input.setRows((current) => [
        ...current,
        createRow("system", t("chat.task.followup.running_hint"), { dim: true }),
      ]);
    } catch {
      input.setRows((current) => [
        ...current,
        createRow("system", t("chat.task.followup.lost_tracking"), { dim: true, style: "error" }),
      ]);
    } finally {
      input.stopWorking();
      input.setProgressText(null);
      await input.persist().catch(() => {});
    }
  })();

  return true;
}
