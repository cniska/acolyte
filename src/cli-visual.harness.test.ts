import { describe, expect, test } from "bun:test";
import { captureCliOutput } from "./cli-test-harness";
import { updateMode } from "./cli-update";

describe("cli visual regression (harness)", () => {
  test("update command prints network error when github api is unavailable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (..._args: Parameters<typeof fetch>) =>
      new Response("no", { status: 503 })) as unknown as typeof fetch;
    try {
      const out = await captureCliOutput(async () => {
        await updateMode();
      });
      expect(out).toBe("Could not check for updates. Check your network connection.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
