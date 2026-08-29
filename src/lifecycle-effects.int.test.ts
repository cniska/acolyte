import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SideEffectChunk } from "./agent-contract";
import type { StreamEvent } from "./client-contract";
import { attachLifecycleEffectHandlers, formatEffect, installEffect } from "./lifecycle-effects";
import { createRunContext } from "./test-utils";
import { createSessionContext } from "./tool-session";

// A formatter that rewrites the file and reports itself the way a real one does.
const UPPERCASE =
  "const f=process.argv[1];require('fs').writeFileSync(f,require('fs').readFileSync(f,'utf8').toUpperCase());console.error('Fixed 1 file.')";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "acolyte-effects-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function runFormat(sink: SideEffectChunk[], emitted: StreamEvent[] = []) {
  const ctx = createRunContext({
    workspace,
    policy: {
      ...createRunContext().policy,
      formatCommand: { bin: "node", args: ["-e", UPPERCASE, "$FILES"] },
    },
    sideEffectSink: (event) => sink.push(event),
    emit: (event) => emitted.push(event),
  });
  return formatEffect.run(ctx, { paths: ["a.txt"] });
}

test("a format that rewrites the file draws its own effect row", async () => {
  writeFileSync(join(workspace, "a.txt"), "hello");
  const events: SideEffectChunk[] = [];
  const result = await runFormat(events);

  expect(readFileSync(join(workspace, "a.txt"), "utf8")).toBe("HELLO");

  const effects = events.filter((event) => event.type === "effect");
  expect(effects).toHaveLength(1);
  const emitted = effects[0];
  expect(emitted?.type === "effect" && emitted.row.effect).toBe("format");
  expect(emitted?.type === "effect" && emitted.row.command).toContain("a.txt");
  expect(JSON.stringify(effects)).toContain("Fixed 1 file.");

  // An effect is not a tool call, so it never borrows the tool-output channel.
  expect(events.filter((event) => event.type === "tool-output")).toEqual([]);

  // Nothing about the effect reaches the model: it is host-owned work the model must not repeat.
  expect(result.output).toBeUndefined();
});

test("an effect emits no tool result, since it was never a tool call", async () => {
  writeFileSync(join(workspace, "a.txt"), "hello");
  const emitted: StreamEvent[] = [];
  await runFormat([], emitted);

  expect(emitted.filter((event) => event.type === "tool-result")).toEqual([]);
});

test("a format that changes nothing draws no row at all", async () => {
  writeFileSync(join(workspace, "a.txt"), "HELLO");
  const events: SideEffectChunk[] = [];
  const result = await runFormat(events);

  expect(events).toEqual([]);
  expect(result).toEqual({ type: "done" });
});

// A linter that fails the way a real one does when handed a path that is not there.
const COMPLAIN = "console.error('No such file or directory');process.exit(1)";

test("a write that removed the file runs no effects on its path", async () => {
  const events: SideEffectChunk[] = [];
  const ctx = createRunContext({
    workspace,
    policy: {
      ...createRunContext().policy,
      formatCommand: { bin: "node", args: ["-e", UPPERCASE, "$FILES"] },
      lintCommand: { bin: "node", args: ["-e", COMPLAIN, "$FILES"] },
    },
    sideEffectSink: (event) => events.push(event),
  });
  const session = createSessionContext();
  attachLifecycleEffectHandlers(ctx, session);

  const output = await session.onAfterToolAsync?.({
    toolId: "file-delete",
    toolCallId: "call_1",
    args: { path: "gone.txt" },
    status: "succeeded",
    result: {},
  });

  expect(events).toEqual([]);
  expect(output).toBeUndefined();
});

test("an install that had to run draws a row, and one that was already there draws none", async () => {
  const installCommand = { bin: "node", args: ["-e", "console.log('installed 1 package')"] };
  const events: SideEffectChunk[] = [];
  const ctx = createRunContext({
    workspace,
    policy: { ...createRunContext().policy, installCommand },
    sideEffectSink: (event) => events.push(event),
  });

  await installEffect.run(ctx, { paths: [] });

  const rows = events.filter((event) => event.type === "effect");
  expect(rows).toHaveLength(1);
  const row = rows[0];
  expect(row?.type === "effect" && row.row.effect).toBe("install");
  expect(JSON.stringify(rows)).toContain("installed 1 package");

  // The workspace is installed now, so the next tool call waits for nothing and shows nothing.
  events.length = 0;
  await installEffect.run(ctx, { paths: [] });

  expect(events).toEqual([]);
});
