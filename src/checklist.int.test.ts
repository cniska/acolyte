import { describe, expect, test } from "bun:test";
import type { ChatRow } from "./chat-contract";
import { isChecklistOutput } from "./chat-contract";
import type { ChecklistOutput } from "./checklist-contract";
import { createClient, createMessageHandlerHarness } from "./test-utils";

describe("checklist integration", () => {
  test("checklist event creates a task row with correct content", async () => {
    let snapshot: ChatRow[] = [];
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (_input, options) => {
          options.onEvent({ type: "status", state: { kind: "running", mode: "work" } });
          options.onEvent({
            type: "checklist",
            groupId: "grp_1",
            groupTitle: "Refactoring auth module",
            items: [
              { id: "item_1", label: "read existing auth implementation", status: "pending", order: 0 },
              { id: "item_2", label: "extract token validation", status: "pending", order: 1 },
              { id: "item_3", label: "add unit tests", status: "pending", order: 2 },
            ],
          });
          snapshot = [...rows];
          return { state: "done" as const, model: "gpt-5-mini", output: "done" };
        },
      }),
    });

    await handleMessage("refactor auth");

    const taskRows = snapshot.filter((row) => row.kind === "task" && isChecklistOutput(row.content));
    expect(taskRows).toHaveLength(1);

    const content = taskRows[0]?.content as ChecklistOutput;
    expect(content.groupId).toBe("grp_1");
    expect(content.groupTitle).toBe("Refactoring auth module");
    expect(content.items).toHaveLength(3);
    expect(content.items.every((item) => item.status === "pending")).toBe(true);
  });

  test("subsequent checklist events update the same row in place", async () => {
    let snapshot: ChatRow[] = [];
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (_input, options) => {
          options.onEvent({ type: "status", state: { kind: "running", mode: "work" } });
          // set-checklist creates with all pending
          options.onEvent({
            type: "checklist",
            groupId: "grp_1",
            groupTitle: "Build pipeline",
            items: [
              { id: "s1", label: "lint", status: "pending", order: 0 },
              { id: "s2", label: "test", status: "pending", order: 1 },
            ],
          });
          // checklist-update updates individual items
          options.onEvent({
            type: "checklist",
            groupId: "grp_1",
            groupTitle: "Build pipeline",
            items: [
              { id: "s1", label: "lint", status: "done", order: 0 },
              { id: "s2", label: "test", status: "in_progress", order: 1 },
            ],
          });
          snapshot = [...rows];
          return { state: "done" as const, model: "gpt-5-mini", output: "done" };
        },
      }),
    });

    await handleMessage("run pipeline");

    const taskRows = snapshot.filter((row) => row.kind === "task" && isChecklistOutput(row.content));
    expect(taskRows).toHaveLength(1);

    const content = taskRows[0]?.content as ChecklistOutput;
    expect(content.items[0]?.status).toBe("done");
    expect(content.items[1]?.status).toBe("in_progress");
  });

  test("different group IDs produce separate checklist rows", async () => {
    let snapshot: ChatRow[] = [];
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (_input, options) => {
          options.onEvent({ type: "status", state: { kind: "running", mode: "work" } });
          options.onEvent({
            type: "checklist",
            groupId: "grp_a",
            groupTitle: "Phase A",
            items: [{ id: "a1", label: "step A1", status: "pending", order: 0 }],
          });
          options.onEvent({
            type: "checklist",
            groupId: "grp_b",
            groupTitle: "Phase B",
            items: [{ id: "b1", label: "step B1", status: "pending", order: 0 }],
          });
          snapshot = [...rows];
          return { state: "done" as const, model: "gpt-5-mini", output: "done" };
        },
      }),
    });

    await handleMessage("multi-phase");

    const taskRows = snapshot.filter((row) => row.kind === "task" && isChecklistOutput(row.content));
    expect(taskRows).toHaveLength(2);
    expect((taskRows[0]?.content as ChecklistOutput).groupId).toBe("grp_a");
    expect((taskRows[1]?.content as ChecklistOutput).groupId).toBe("grp_b");
  });

  test("checklist row appears before subsequent tool rows", async () => {
    let snapshot: ChatRow[] = [];
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (_input, options) => {
          options.onEvent({ type: "status", state: { kind: "running", mode: "work" } });
          options.onEvent({
            type: "checklist",
            groupId: "grp_1",
            groupTitle: "Steps",
            items: [{ id: "s1", label: "do thing", status: "pending", order: 0 }],
          });
          options.onEvent({
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "file-read",
            args: { path: "a.ts" },
          });
          options.onEvent({
            type: "tool-output",
            toolCallId: "call_1",
            toolName: "file-read",
            content: { kind: "tool-header", labelKey: "tool.label.file_read", detail: "a.ts" },
          });
          snapshot = [...rows];
          return { state: "done" as const, model: "gpt-5-mini", output: "done" };
        },
      }),
    });

    await handleMessage("go");

    const taskIndex = snapshot.findIndex((row) => row.kind === "task" && isChecklistOutput(row.content));
    const toolIndex = snapshot.findIndex((row) => row.kind === "tool");
    expect(taskIndex).toBeGreaterThanOrEqual(0);
    expect(toolIndex).toBeGreaterThanOrEqual(0);
    expect(taskIndex).toBeLessThan(toolIndex);
  });

  test("checklist events do not break tool output rows", async () => {
    let snapshot: ChatRow[] = [];
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (_input, options) => {
          options.onEvent({ type: "status", state: { kind: "running", mode: "work" } });
          options.onEvent({
            type: "checklist",
            groupId: "grp_1",
            groupTitle: "Steps",
            items: [{ id: "s1", label: "edit file", status: "in_progress", order: 0 }],
          });
          options.onEvent({
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "file-edit",
            args: { path: "a.ts" },
          });
          options.onEvent({
            type: "tool-output",
            toolCallId: "call_1",
            toolName: "file-edit",
            content: { kind: "tool-header", labelKey: "tool.label.file_edit", detail: "a.ts" },
          });
          options.onEvent({
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "file-edit",
          });
          snapshot = [...rows];
          return { state: "done" as const, model: "gpt-5-mini", output: "done" };
        },
      }),
    });

    await handleMessage("edit something");

    const taskRows = snapshot.filter((row) => row.kind === "task" && isChecklistOutput(row.content));
    const toolRows = snapshot.filter((row) => row.kind === "tool");
    expect(taskRows).toHaveLength(1);
    expect(toolRows).toHaveLength(1);
  });

  test("checklist rows are removed after turn completes", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (_input, options) => {
          options.onEvent({ type: "status", state: { kind: "running", mode: "work" } });
          options.onEvent({
            type: "checklist",
            groupId: "grp_1",
            groupTitle: "Steps",
            items: [{ id: "s1", label: "do thing", status: "done", order: 0 }],
          });
          return { state: "done" as const, model: "gpt-5-mini", output: "done" };
        },
      }),
    });

    await handleMessage("go");

    const checklistRows = rows.filter((row) => row.kind === "task" && isChecklistOutput(row.content));
    expect(checklistRows).toHaveLength(0);
  });

  test("checklist rows are removed on abort", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (_input, options) => {
          options.onEvent({ type: "status", state: { kind: "running", mode: "work" } });
          options.onEvent({
            type: "checklist",
            groupId: "grp_1",
            groupTitle: "Steps",
            items: [{ id: "s1", label: "do thing", status: "in_progress", order: 0 }],
          });
          throw Object.assign(new Error("aborted"), { name: "AbortError" });
        },
      }),
    });

    await handleMessage("go");

    const checklistRows = rows.filter((row) => row.kind === "task" && isChecklistOutput(row.content));
    expect(checklistRows).toHaveLength(0);
  });
});
