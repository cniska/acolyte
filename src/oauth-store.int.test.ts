import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { readOAuthTokensSync, removeOAuthTokens, writeOAuthTokens } from "./oauth-store";
import { configDir } from "./paths";
import { tempDir } from "./test-utils";

const dirs = tempDir();
afterEach(dirs.cleanupDirs);

function createTempHome(): string {
  return dirs.createDir("oauth-test-");
}

const tokens = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: 1_700_000_000_000,
  accountId: "acct_1",
};

describe("oauth-store", () => {
  test("readOAuthTokensSync returns undefined when no file exists", () => {
    expect(readOAuthTokensSync("openai", { HOME: "/nonexistent" })).toBeUndefined();
  });

  test("writeOAuthTokens round-trips through readOAuthTokensSync", async () => {
    const env = { HOME: createTempHome() };
    await writeOAuthTokens("openai", tokens, env);
    expect(readOAuthTokensSync("openai", env)).toEqual(tokens);
  });

  test("writeOAuthTokens overwrites existing tokens", async () => {
    const env = { HOME: createTempHome() };
    await writeOAuthTokens("openai", tokens, env);
    const next = { ...tokens, accessToken: "access-2" };
    await writeOAuthTokens("openai", next, env);
    expect(readOAuthTokensSync("openai", env)).toEqual(next);
  });

  test("removeOAuthTokens clears the provider entry", async () => {
    const env = { HOME: createTempHome() };
    await writeOAuthTokens("openai", tokens, env);
    await removeOAuthTokens("openai", env);
    expect(readOAuthTokensSync("openai", env)).toBeUndefined();
  });

  test("corrupt file is treated as absent", async () => {
    const env = { HOME: createTempHome() };
    const dir = configDir(env);
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "oauth.json"), "{ not json", "utf8");
    expect(readOAuthTokensSync("openai", env)).toBeUndefined();
  });

  test("oauth file is written with 0o600 permissions", async () => {
    const env = { HOME: createTempHome() };
    await writeOAuthTokens("openai", tokens, env);
    const mode = statSync(join(configDir(env), "oauth.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("removeOAuthTokens is a no-op when file is absent", async () => {
    const env = { HOME: createTempHome() };
    await removeOAuthTokens("openai", env);
    expect(existsSync(join(configDir(env), "oauth.json"))).toBe(false);
  });
});
