import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SideEffectChunk } from "./agent-contract";
import type { StreamEvent } from "./client-contract";
import { formatEffect } from "./lifecycle-effects";
import { createRunContext } from "./test-utils";

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
