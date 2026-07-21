import { expect, test } from "bun:test";
import { ChatChecklist } from "./chat-checklist";
import type { TranscriptRow } from "./chat-transcript-contract";
import { renderPlain } from "./tui/test-utils";

const row = {
  id: "row_checklist",
  kind: "task" as const,
  content: {
    groupId: "group_1",
    groupTitle: "Plan",
    items: [{ id: "item_1", label: "Inspect code", status: "in_progress" as const, order: 0 }],
  },
};

test("semantic checklist scene preserves the legacy checklist projection", () => {
  const legacy = renderPlain(<ChatChecklist rows={[row]} />, 80);
  const presentation: TranscriptRow = {
    id: row.id,
    kind: "task",
    lifecycle: "active",
    content: { kind: "checklist", output: row.content },
  };
  expect(renderPlain(<ChatChecklist rows={[row]} presentation={[presentation]} />, 80)).toBe(legacy);
});
