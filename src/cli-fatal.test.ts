import { expect, test } from "bun:test";
import { fatalDebugEnabled, formatFatalError } from "./cli-fatal";
import { CloudApiError } from "./cloud-client";
import { CodedError } from "./coded-error";

test("a coded error with guidance says what to do, not what the server said", () => {
  const error = new CloudApiError(401, "Cloud API GET /api/v1/sessions failed (401)", '{"error":"Invalid token"}');
  expect(formatFatalError(error)).toEqual([
    "Your cloud session has expired. Run `acolyte login` to sign in again, or `acolyte logout` to keep working offline. (E_CLOUD_UNAUTHORIZED)",
  ]);
});

test("the server body reaches the user only under the debug flag", () => {
  const error = new CloudApiError(401, "Cloud API GET /api/v1/sessions failed (401)", '{"error":"Invalid token"}');
  const lines = formatFatalError(error, { debug: true });
  expect(lines[0]).toContain("acolyte login");
  expect(lines[1]).toBe('Cloud API GET /api/v1/sessions failed (401) [body: {"error":"Invalid token"}]');
});

test("a coded error without guidance keeps its own message", () => {
  const error = new CodedError("E_DAEMON_LOST", "The server stopped while this turn was running.");
  expect(formatFatalError(error)).toEqual(["The server stopped while this turn was running. (E_DAEMON_LOST)"]);
});

test("a code from outside the contract falls back to its message", () => {
  const error = new CodedError("E_SOMETHING_A_PLUGIN_THREW", "plugin exploded");
  expect(formatFatalError(error)).toEqual(["plugin exploded (E_SOMETHING_A_PLUGIN_THREW)"]);
});

test("a plain error reports only its message", () => {
  expect(formatFatalError(new Error("disk is full"))).toEqual(["disk is full"]);
});

test("a non-error throwable still produces a line", () => {
  expect(formatFatalError("something went wrong")).toEqual(["something went wrong"]);
});

test("the stack is appended only when asked for", () => {
  const error = new Error("boom");
  expect(formatFatalError(error, { debug: true })).toHaveLength(2);
  expect(formatFatalError(error, { debug: false })).toHaveLength(1);
});

test("debug output is gated on the cli flag", () => {
  expect(fatalDebugEnabled("cli")).toBe(true);
  expect(fatalDebugEnabled("*")).toBe(true);
  expect(fatalDebugEnabled("lifecycle")).toBe(false);
  expect(fatalDebugEnabled(undefined)).toBe(false);
});
