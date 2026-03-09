import { describe, expect, test } from "bun:test";
import { requestLocalServerShutdown } from "./cli-server";

describe("cli-server", () => {
  test("requestLocalServerShutdown returns false for unreachable port", async () => {
    const result = await requestLocalServerShutdown({ port: 1, timeoutMs: 100 });
    expect(result).toBe(false);
  });
});
