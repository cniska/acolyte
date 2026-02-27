import { describe, expect, test } from "bun:test";
import { createSessionContext, recordCall, runGuards } from "./tool-guards";

describe("no-rewrite guard", () => {
  test("allows delete when path was NOT read", () => {
    const session = createSessionContext();
    expect(() => runGuards({ toolName: "delete-file", args: { path: "src/foo.ts" }, session })).not.toThrow();
  });

  test("blocks delete when path WAS read", () => {
    const session = createSessionContext();
    recordCall(session, "read-file", { paths: [{ path: "src/foo.ts" }] });
    expect(() => runGuards({ toolName: "delete-file", args: { path: "src/foo.ts" }, session })).toThrow(
      /Cannot delete.*src\/foo\.ts/,
    );
  });

  test("normalizes ./ prefixed paths", () => {
    const session = createSessionContext();
    recordCall(session, "read-file", { paths: [{ path: "./src/foo.ts" }] });
    expect(() => runGuards({ toolName: "delete-file", args: { path: "src/foo.ts" }, session })).toThrow(
      /Cannot delete/,
    );
  });

  test("is no-op for other tools", () => {
    const session = createSessionContext();
    recordCall(session, "read-file", { paths: [{ path: "src/foo.ts" }] });
    expect(() => runGuards({ toolName: "edit-file", args: { path: "src/foo.ts" }, session })).not.toThrow();
  });
});

describe("verify-ran guard", () => {
  test("sets flag when command contains verify", () => {
    const session = createSessionContext();
    runGuards({ toolName: "run-command", args: { command: "bun run verify" }, session });
    expect(session.flags.verifyRan).toBe(true);
  });

  test("does not set flag for unrelated commands", () => {
    const session = createSessionContext();
    runGuards({ toolName: "run-command", args: { command: "bun run build" }, session });
    expect(session.flags.verifyRan).toBeUndefined();
  });
});

describe("recordCall", () => {
  test("appends to callLog", () => {
    const session = createSessionContext();
    expect(session.callLog).toHaveLength(0);
    recordCall(session, "read-file", { paths: [{ path: "a.ts" }] });
    recordCall(session, "edit-file", { path: "a.ts" });
    expect(session.callLog).toHaveLength(2);
    expect(session.callLog[0]?.toolName).toBe("read-file");
    expect(session.callLog[1]?.toolName).toBe("edit-file");
  });
});
