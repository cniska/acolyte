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

describe("no-shell-read-fallback guard", () => {
  test("blocks shell file-reading fallback commands", () => {
    const session = createSessionContext();
    expect(() =>
      runGuards({ toolName: "run-command", args: { command: "sed -n '1,50p' src/cli.ts" }, session }),
    ).toThrow(/Do not use shell commands for file reading\/searching/);
  });

  test("allows verify/test style run-command invocations", () => {
    const session = createSessionContext();
    expect(() => runGuards({ toolName: "run-command", args: { command: "bun run verify" }, session })).not.toThrow();
    expect(() => runGuards({ toolName: "run-command", args: { command: "bun run test" }, session })).not.toThrow();
  });
});

describe("excessive-file-loop guard", () => {
  test("blocks repeated read/edit churn on same path before verify", () => {
    const session = createSessionContext();
    for (let i = 0; i < 6; i += 1) {
      recordCall(session, "read-file", { paths: [{ path: "src/foo.ts" }] });
      recordCall(session, "edit-file", { path: "src/foo.ts" });
    }
    expect(() => runGuards({ toolName: "read-file", args: { paths: [{ path: "src/foo.ts" }] }, session })).toThrow(
      /Repeated read\/edit loop detected/,
    );
  });

  test("still blocks heavy churn even when verify already ran", () => {
    const session = createSessionContext();
    session.flags.verifyRan = true;
    for (let i = 0; i < 8; i += 1) {
      recordCall(session, "read-file", { paths: [{ path: "src/foo.ts" }] });
      recordCall(session, "edit-file", { path: "src/foo.ts" });
    }
    expect(() => runGuards({ toolName: "edit-file", args: { path: "src/foo.ts" }, session })).toThrow(
      /Repeated read\/edit loop detected/,
    );
  });

  test("does not block low-volume activity after verify", () => {
    const session = createSessionContext();
    session.flags.verifyRan = true;
    recordCall(session, "read-file", { paths: [{ path: "src/foo.ts" }] });
    recordCall(session, "edit-file", { path: "src/foo.ts" });
    recordCall(session, "read-file", { paths: [{ path: "src/foo.ts" }] });
    recordCall(session, "edit-file", { path: "src/foo.ts" });
    expect(() => runGuards({ toolName: "edit-file", args: { path: "src/foo.ts" }, session })).not.toThrow();
  });

  test("does not block when churn is spread across files", () => {
    const session = createSessionContext();
    for (let i = 0; i < 6; i += 1) {
      recordCall(session, "read-file", { paths: [{ path: "src/a.ts" }] });
      recordCall(session, "edit-file", { path: "src/a.ts" });
      recordCall(session, "read-file", { paths: [{ path: "src/b.ts" }] });
      recordCall(session, "edit-file", { path: "src/b.ts" });
    }
    expect(() => runGuards({ toolName: "read-file", args: { paths: [{ path: "src/c.ts" }] }, session })).not.toThrow();
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
