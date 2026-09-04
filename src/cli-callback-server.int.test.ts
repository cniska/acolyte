import { describe, expect, test } from "bun:test";
import { startCallbackServer } from "./cli-callback-server";
import { errorCode } from "./error-contract";

async function callback(port: number, query: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/callback?${query}`);
}

describe("the sign-in callback", () => {
  test("hands back the code the browser carried", async () => {
    const { port, result } = await startCallbackServer("st_1");

    const response = await callback(port, "code=code_1&state=st_1");

    expect(response.status).toBe(200);
    expect(await result).toEqual({ code: "code_1" });
  });

  test("a mismatched state is refused and leaves the real callback still expected", async () => {
    const { port, result } = await startCallbackServer("st_1");

    expect((await callback(port, "code=code_1&state=wrong")).status).toBe(400);

    const response = await callback(port, "code=code_2&state=st_1");
    expect(response.status).toBe(200);
    expect(await result).toEqual({ code: "code_2" });
  });

  test("a callback with no code fails the sign-in rather than leaving it waiting", async () => {
    const { port, result } = await startCallbackServer("st_1");
    // Attached before the request that rejects it, as the sign-in itself awaits this promise first.
    const settled = result.catch((thrown) => thrown);

    const response = await callback(port, "state=st_1&error=access_denied");

    expect(response.status).toBe(400);
    expect(errorCode(await settled)).toBe("E_LOGIN_CODE_MISSING");
  });

  test("another path is not the callback", async () => {
    const { port, result } = await startCallbackServer("st_1");

    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);

    await callback(port, "code=code_1&state=st_1");
    await result;
  });
});
