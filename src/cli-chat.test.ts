import { afterEach, describe, expect, test } from "bun:test";
import { createFatalErrorHandler, formatResumeCommand } from "./cli-chat";
import { CloudApiError } from "./cloud-client";

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
