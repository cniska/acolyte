import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { authMode } from "./cli-auth";
import type { OAuthCallbackServer } from "./openai-oauth-server";
import type { ProviderApiEnvKey } from "./provider-contract";

const tokens = { accessToken: "a", refreshToken: "r", expiresAt: 1, accountId: "acct" };

function createDeps(overrides: Partial<Parameters<typeof authMode>[1]> = {}) {
  const server: OAuthCallbackServer = {
    result: Promise.resolve({ code: "the-code" }),
    stop: mock(async () => {}),
  };
  const writes: Array<{ envKey: ProviderApiEnvKey; value: string }> = [];
  const removes: ProviderApiEnvKey[] = [];
  const base = {
    hasHelpFlag: () => false,
    prompt: mock((_q: string) => null as string | null),
    promptHidden: mock(async (_q: string) => "sk-new" as string | undefined),
    printDim: mock((_: string) => {}),
    printError: mock((_: string) => {}),
    openBrowser: mock((_: string) => {}),
    createState: () => "state-1",
    startCallbackServer: mock((_: string) => server),
    exchangeCode: mock(async () => tokens),
    writeOAuthTokens: mock(async () => {}),
    removeOAuthTokens: mock(async () => {}),
    readOAuthTokens: mock(() => undefined),
    readProviderApiKeys: mock(() => ({}) as Partial<Record<ProviderApiEnvKey, string>>),
    readConfiguredProviderApiKeys: mock(() => ({})),
    writeProviderApiKey: mock(async (envKey: ProviderApiEnvKey, value: string) => {
      writes.push({ envKey, value });
    }),
    removeProviderApiKey: mock(async (envKey: ProviderApiEnvKey) => {
      removes.push(envKey);
    }),
    credentialsPath: () => "/home/user/.acolyte/credentials",
    commandError: mock((_: string, __?: string) => {}),
    commandHelp: mock((_: string) => {}),
  };
  return { deps: { ...base, ...overrides }, server, writes, removes };
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

  test("no args prints status for every provider", async () => {
    const { deps } = createDeps({
      readOAuthTokens: mock((provider: string) => (provider === "openai" ? tokens : undefined)),
      readConfiguredProviderApiKeys: mock(() => ({ anthropic: "sk-a" })),
    });
    await authMode([], deps);
    const messages = (deps.printDim as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
    expect(messages.some((m) => m.includes("anthropic") && m.includes("api key"))).toBe(true);
    expect(messages.some((m) => m.includes("openai") && m.includes("subscription"))).toBe(true);
    expect(messages.some((m) => m.includes("google") && m.includes("none"))).toBe(true);
    expect(deps.startCallbackServer).not.toHaveBeenCalled();
  });

  test("unsupported provider errors", async () => {
    const { deps } = createDeps();
    await authMode(["nope"], deps);
    expect(deps.printError).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(deps.startCallbackServer).not.toHaveBeenCalled();
  });

  test("key-only provider writes API key without method prompt", async () => {
    const { deps, writes } = createDeps();
    await authMode(["anthropic"], deps);
    expect(deps.prompt).not.toHaveBeenCalled();
    expect(writes).toEqual([{ envKey: "ANTHROPIC_API_KEY", value: "sk-new" }]);
    expect(deps.startCallbackServer).not.toHaveBeenCalled();
  });

  test("status lists an environment-provided API key", async () => {
    const { deps } = createDeps({ readConfiguredProviderApiKeys: mock(() => ({ openai: "sk-env" })) });
    await authMode([], deps);
    const messages = (deps.printDim as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
    expect(messages.some((m) => m.includes("openai") && m.includes("api key"))).toBe(true);
  });

  test("vercel maps to AI_GATEWAY_API_KEY", async () => {
    const { deps, writes } = createDeps();
    await authMode(["vercel", "--key"], deps);
    expect(writes).toEqual([{ envKey: "AI_GATEWAY_API_KEY", value: "sk-new" }]);
  });

  test("existing key: declining the override leaves it unchanged", async () => {
    const { deps, writes } = createDeps({
      readProviderApiKeys: mock(() => ({ OPENAI_API_KEY: "sk-existing" })),
      prompt: mock(() => "n"),
    });
    await authMode(["openai", "--key"], deps);
    expect(writes).toEqual([]);
    expect((deps.printDim as ReturnType<typeof mock>).mock.calls.some((c) => String(c[0]).includes("unchanged"))).toBe(
      true,
    );
  });

  test("existing key: confirming the override writes the new key", async () => {
    const { deps, writes } = createDeps({
      readProviderApiKeys: mock(() => ({ AI_GATEWAY_API_KEY: "old" })),
      prompt: mock(() => "y"),
    });
    await authMode(["vercel"], deps);
    expect(writes).toEqual([{ envKey: "AI_GATEWAY_API_KEY", value: "sk-new" }]);
  });

  test("openai without flags prompts for method", async () => {
    const { deps, writes } = createDeps({ prompt: mock(() => "key") });
    await authMode(["openai"], deps);
    expect(deps.prompt).toHaveBeenCalled();
    expect(writes).toEqual([{ envKey: "OPENAI_API_KEY", value: "sk-new" }]);
    expect(deps.startCallbackServer).not.toHaveBeenCalled();
  });

  test("openai --subscription runs OAuth", async () => {
    const { deps } = createDeps();
    await authMode(["openai", "--subscription"], deps);
    expect(deps.openBrowser).toHaveBeenCalled();
    expect(deps.exchangeCode).toHaveBeenCalledWith({ code: "the-code", verifier: expect.any(String) });
    expect(deps.writeOAuthTokens).toHaveBeenCalledWith("openai", tokens);
    expect(process.exitCode).toBe(0);
  });

  test("openai method subscription runs OAuth", async () => {
    const { deps } = createDeps({ prompt: mock(() => "subscription") });
    await authMode(["openai"], deps);
    expect(deps.writeOAuthTokens).toHaveBeenCalledWith("openai", tokens);
  });

  test("existing subscription: declining the override leaves it unchanged", async () => {
    const { deps } = createDeps({ readOAuthTokens: mock(() => tokens), prompt: mock(() => "n") });
    await authMode(["openai", "--subscription"], deps);
    expect(deps.startCallbackServer).not.toHaveBeenCalled();
    expect(deps.writeOAuthTokens).not.toHaveBeenCalled();
    expect((deps.printDim as ReturnType<typeof mock>).mock.calls.some((c) => String(c[0]).includes("unchanged"))).toBe(
      true,
    );
  });

  test("existing subscription: confirming the override runs OAuth", async () => {
    const { deps } = createDeps({ readOAuthTokens: mock(() => tokens), prompt: mock(() => "y") });
    await authMode(["openai", "--subscription"], deps);
    expect(deps.writeOAuthTokens).toHaveBeenCalledWith("openai", tokens);
  });

  test("--key and --subscription together error", async () => {
    const { deps } = createDeps();
    await authMode(["openai", "--key", "--subscription"], deps);
    expect(deps.printError).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(deps.startCallbackServer).not.toHaveBeenCalled();
  });

  test("--subscription on key-only provider errors", async () => {
    const { deps } = createDeps();
    await authMode(["anthropic", "--subscription"], deps);
    expect(deps.printError).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test("--logout removes key and subscription", async () => {
    const { deps, removes } = createDeps({
      readOAuthTokens: mock(() => tokens),
      readProviderApiKeys: mock(() => ({ OPENAI_API_KEY: "sk" })),
    });
    await authMode(["openai", "--logout"], deps);
    expect(removes).toEqual(["OPENAI_API_KEY"]);
    expect(deps.removeOAuthTokens).toHaveBeenCalledWith("openai");
    expect(deps.startCallbackServer).not.toHaveBeenCalled();
  });

  test("--logout when nothing stored does not call remove", async () => {
    const { deps, removes } = createDeps();
    await authMode(["openai", "--logout"], deps);
    expect(removes).toEqual([]);
    expect(deps.removeOAuthTokens).not.toHaveBeenCalled();
  });

  test("--logout --key removes only the stored API key", async () => {
    const { deps, removes } = createDeps({
      readOAuthTokens: mock(() => tokens),
      readProviderApiKeys: mock(() => ({ OPENAI_API_KEY: "sk" })),
    });
    await authMode(["openai", "--logout", "--key"], deps);
    expect(removes).toEqual(["OPENAI_API_KEY"]);
    expect(deps.removeOAuthTokens).not.toHaveBeenCalled();
  });

  test("--logout --subscription removes only OAuth tokens", async () => {
    const { deps, removes } = createDeps({
      readOAuthTokens: mock(() => tokens),
      readProviderApiKeys: mock(() => ({ OPENAI_API_KEY: "sk" })),
    });
    await authMode(["openai", "--logout", "--subscription"], deps);
    expect(removes).toEqual([]);
    expect(deps.removeOAuthTokens).toHaveBeenCalledWith("openai");
  });

  test("login failure stops the server and sets exit code", async () => {
    const { deps, server } = createDeps({
      exchangeCode: mock(async () => {
        throw new Error("boom");
      }),
    });
    await authMode(["openai", "--subscription"], deps);
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
    await authMode(["openai", "--subscription"], deps);
    expect(deps.printError).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
