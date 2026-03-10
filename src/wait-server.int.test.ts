import { describe, expect, test } from "bun:test";
import { waitForServer } from "../scripts/wait-server";
import { startTestServer } from "./test-utils";

describe("wait-server", () => {
  test("waitForServer resolves when endpoint is healthy", async () => {
    const server = startTestServer(() =>
      Response.json({
        ok: true,
      }),
    );
    try {
      await expect(waitForServer(`http://127.0.0.1:${server.port}/v1/status`, 1000)).resolves.toBeUndefined();
    } finally {
      server.stop();
    }
  });

  test("waitForServer times out when endpoint stays unavailable", async () => {
    await expect(waitForServer("http://127.0.0.1:9/v1/status", 250)).rejects.toThrow(
      "Timed out waiting for server at http://127.0.0.1:9/v1/status",
    );
  });
});
