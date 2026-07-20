import { describe, expect, test } from "bun:test";
import { CodedError } from "./coded-error";
import { OPENAI_OAUTH_REDIRECT_PORT } from "./openai-oauth-contract";
import { OAUTH_SERVER_ERROR_CODE, startOAuthCallbackServer } from "./openai-oauth-server";

const CALLBACK = `http://127.0.0.1:${OPENAI_OAUTH_REDIRECT_PORT}/auth/callback`;

describe("startOAuthCallbackServer", () => {
  test("binds the fixed port, rejects a second bind, and delivers the callback code", async () => {
    const server = startOAuthCallbackServer("st-1");
    try {
      let caught: unknown;
      try {
        startOAuthCallbackServer("st-2");
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CodedError);
      expect((caught as CodedError).code).toBe(OAUTH_SERVER_ERROR_CODE);
      expect((caught as CodedError).kind).toBe("port_in_use");

      const res = await fetch(`${CALLBACK}?code=abc&state=st-1`);
      expect(res.status).toBe(200);
      await res.text();
      expect(await server.result).toEqual({ code: "abc" });
    } finally {
      void server.stop();
    }
  });
});
