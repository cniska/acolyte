import { afterEach, describe, expect, test } from "bun:test";
import { createFatalErrorHandler, formatResumeCommand, sessionModelFor } from "./cli-chat";
import { CloudApiError } from "./cloud-client";
import { createSession } from "./test-utils";

describe("cli", () => {
  test("formatResumeCommand returns prod-friendly command", () => {
    expect(formatResumeCommand("sess_abcdef1234567890")).toBe("acolyte resume sess_abcdef1234567890");
  });
});

describe("fatal chat errors", () => {
  const debugBefore = process.env.ACOLYTE_DEBUG;

  afterEach(() => {
    if (debugBefore === undefined) delete process.env.ACOLYTE_DEBUG;
    else process.env.ACOLYTE_DEBUG = debugBefore;
  });

  function capture(error: unknown): { lines: string[]; released: number; exits: number } {
    const lines: string[] = [];
    let released = 0;
    let exits = 0;
    createFatalErrorHandler({
      releaseLock: () => {
        released += 1;
      },
      print: (line) => lines.push(line),
      exit: () => {
        exits += 1;
      },
    })(error);
    return { lines, released, exits };
  }

  test("a dead cloud token exits with guidance instead of a stack", () => {
    delete process.env.ACOLYTE_DEBUG;
    const error = new CloudApiError(401, "Cloud API GET /api/v1/sessions failed (401)", '{"error":"Invalid token"}');

    const { lines, released, exits } = capture(error);

    expect(lines[0]).toBe(
      "Your cloud session has expired. Run `acolyte login` to sign in again, or `acolyte logout` to keep working offline. (E_CLOUD_UNAUTHORIZED)",
    );
    expect(lines).toHaveLength(1);
    expect(released).toBe(1);
    expect(exits).toBe(1);
  });

  test("the stack reaches the user only under the cli debug flag", () => {
    process.env.ACOLYTE_DEBUG = "cli";
    const { lines } = capture(new CloudApiError(401, "Cloud API GET /api/v1/sessions failed (401)", "{}"));
    expect(lines.some((line) => line.includes("CloudApiError"))).toBe(true);
  });
});

describe("sessionModelFor", () => {
  test("a fresh chat takes the configured model", () => {
    expect(sessionModelFor(null, "anthropic/claude-sonnet-4")).toBe("anthropic/claude-sonnet-4");
  });

  test("a fresh chat has no model when none is configured", () => {
    expect(sessionModelFor(null, undefined)).toBeUndefined();
  });

  test("a resumed session keeps its own model even when none is configured", () => {
    const session = createSession({ model: "openai/gpt-5.2" });
    expect(sessionModelFor({ kind: "ok", session }, undefined)).toBe("openai/gpt-5.2");
  });

  test("a resumed session keeps its own model over the configured one", () => {
    const session = createSession({ model: "openai/gpt-5.2" });
    expect(sessionModelFor({ kind: "ok", session }, "anthropic/claude-sonnet-4")).toBe("openai/gpt-5.2");
  });
});
