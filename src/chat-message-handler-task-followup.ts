import { type ChatRow, createRow } from "./chat-commands";
import type { Client } from "./client-contract";
import { t } from "./i18n";
import { palette } from "./palette";

type SetRows = (updater: (current: ChatRow[]) => ChatRow[]) => void;

type StartRemoteTaskFollowupInput = {
  client: Client;
  remoteTaskId: string;
  setRows: SetRows;
  setProgressText: (next: string | null) => void;
  persist: () => Promise<void>;
  stopWorking: () => void;
};

const MAX_POLL_ITERATIONS = 300;
const POLL_INTERVAL_MS = 700;

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
      for (let pollCount = 0; pollCount < MAX_POLL_ITERATIONS; pollCount += 1) {
        await Bun.sleep(POLL_INTERVAL_MS);
        const next = await input.client.taskStatus(input.remoteTaskId);
        if (!next || next.state === "running" || next.state === "detached") continue;
        if (next.state === "failed") {
          input.setRows((current) => [
            ...current,
            createRow("task", t("chat.task.followup.failed"), { dim: true, marker: palette.error }),
          ]);
        } else if (next.state === "cancelled") {
          input.setRows((current) => [
            ...current,
            createRow("task", t("chat.task.followup.cancelled"), { dim: true, marker: palette.cancelled }),
          ]);
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
        createRow("system", t("chat.task.followup.lost_tracking"), { dim: true, text: palette.error }),
      ]);
    } finally {
      input.stopWorking();
      input.setProgressText(null);
      await input.persist().catch(() => {});
    }
  })();

  return true;
}
