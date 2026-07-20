import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { authMode } from "./cli-auth";
import type { OAuthCallbackServer } from "./openai-oauth-server";

const tokens = { accessToken: "a", refreshToken: "r", expiresAt: 1, accountId: "acct" };

function createDeps(overrides: Partial<Parameters<typeof authMode>[1]> = {}) {
  const server: OAuthCallbackServer = {
    result: Promise.resolve({ code: "the-code" }),
    stop: mock(async () => {}),
  };
  const base = {
    hasHelpFlag: () => false,
    printDim: mock((_: string) => {}),
    printError: mock((_: string) => {}),
    openBrowser: mock((_: string) => {}),
    createState: () => "state-1",
    startCallbackServer: mock((_: string) => server),
    exchangeCode: mock(async () => tokens),
    writeOAuthTokens: mock(async () => {}),
    removeOAuthTokens: mock(async () => {}),
    readOAuthTokens: mock(() => undefined),
    commandError: mock((_: string, __?: string) => {}),
    commandHelp: mock((_: string) => {}),
  };
  return { deps: { ...base, ...overrides }, server };
}

beforeEach(() => {
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = 0;
});

describe("authMode", () => {
  test("prints help with --help", async () => {
    const { deps } = createDeps({ hasHelpFlag: () => true });
    await authMode(["--help"], deps);
    expect(deps.commandHelp).toHaveBeenCalledWith("auth");
  });

  test("no args prints 'none connected' status", async () => {
    const { deps } = createDeps();
    await authMode([], deps);
    expect(deps.readOAuthTokens).toHaveBeenCalledWith("openai");
    expect(deps.printDim).toHaveBeenCalled();
    expect(deps.startCallbackServer).not.toHaveBeenCalled();
  });

  test("no args lists connected providers", async () => {
    const { deps } = createDeps({ readOAuthTokens: mock(() => tokens) });
    await authMode([], deps);
    const messages = (deps.printDim as ReturnType<typeof mock>).mock.calls.map((c) => c[0]);
    expect(messages.some((m: string) => m.includes("openai"))).toBe(true);
  });

  test("unsupported provider errors", async () => {
    const { deps } = createDeps();
    await authMode(["anthropic"], deps);
    expect(deps.commandError).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(deps.startCallbackServer).not.toHaveBeenCalled();
  });

  test("--logout removes tokens when connected", async () => {
    const { deps } = createDeps({ readOAuthTokens: mock(() => tokens) });
    await authMode(["openai", "--logout"], deps);
    expect(deps.removeOAuthTokens).toHaveBeenCalledWith("openai");
    expect(deps.startCallbackServer).not.toHaveBeenCalled();
  });

  test("--logout when not connected does not call remove", async () => {
    const { deps } = createDeps();
    await authMode(["openai", "--logout"], deps);
    expect(deps.removeOAuthTokens).not.toHaveBeenCalled();
  });

  test("login flow exchanges code and persists tokens", async () => {
    const { deps } = createDeps();
    await authMode(["openai"], deps);
    expect(deps.openBrowser).toHaveBeenCalled();
    expect(deps.exchangeCode).toHaveBeenCalledWith({ code: "the-code", verifier: expect.any(String) });
    expect(deps.writeOAuthTokens).toHaveBeenCalledWith("openai", tokens);
    expect(process.exitCode).toBe(0);
  });

  test("login failure stops the server and sets exit code", async () => {
    const { deps, server } = createDeps({
      exchangeCode: mock(async () => {
        throw new Error("boom");
      }),
    });
    await authMode(["openai"], deps);
    expect(server.stop).toHaveBeenCalled();
    expect(deps.printError).toHaveBeenCalled();
    expect(deps.writeOAuthTokens).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test("port-in-use is reported and does not crash", async () => {
    const { deps } = createDeps({
      startCallbackServer: mock(() => {
        throw new Error("port in use");
      }),
    });
    await authMode(["openai"], deps);
    expect(deps.printError).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
