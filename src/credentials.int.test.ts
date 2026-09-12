import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  decodeTokenSubject,
  readCredentialsSync,
  readProviderApiKeysSync,
  removeCredential,
  removeCredentials,
  removeProviderApiKey,
  writeCredential,
  writeProviderApiKey,
} from "./credentials";
import { configDir } from "./paths";
import { tempDir } from "./test-utils";

const dirs = tempDir();
afterEach(dirs.cleanupDirs);

function createTempHome(): string {
  return dirs.createDir("creds-test-");
}

describe("credentials", () => {
  test("readCredentialsSync returns empty when no file exists", () => {
    expect(readCredentialsSync({ HOME: "/nonexistent" })).toEqual({});
  });

  test("writeCredential creates file and readCredentialsSync reads it", async () => {
    const env = { HOME: createTempHome() };
    await writeCredential("cloudToken", "tok_abc123", env);
    const creds = readCredentialsSync(env);
    expect(creds).toEqual({ cloudToken: "tok_abc123" });
  });

  test("writeCredential preserves existing credentials", async () => {
    const env = { HOME: createTempHome() };
    await writeCredential("cloudUrl", "https://cloud.example.com", env);
    await writeCredential("cloudToken", "tok_abc123", env);
    const creds = readCredentialsSync(env);
    expect(creds).toEqual({ cloudUrl: "https://cloud.example.com", cloudToken: "tok_abc123" });
  });

  test("writeCredential overwrites existing value", async () => {
    const env = { HOME: createTempHome() };
    await writeCredential("cloudToken", "old", env);
    await writeCredential("cloudToken", "new", env);
    const creds = readCredentialsSync(env);
    expect(creds).toEqual({ cloudToken: "new" });
  });

  test("a write replaces the file instead of rewriting it in place, so no reader sees it empty", async () => {
    const env = { HOME: createTempHome() };
    await writeCredential("cloudToken", "tok_initial", env);
    const path = join(configDir(env), "credentials");
    const before = statSync(path).ino;

    await writeCredential("cloudToken", "tok_renewed", env);

    // A truncating write keeps the inode and empties the file first; a rename swaps a finished file
    // in, which is what leaves a concurrent reader with either the old contents or the new.
    expect(statSync(path).ino).not.toBe(before);
    expect(readCredentialsSync(env).cloudToken).toBe("tok_renewed");
    expect(readdirSync(configDir(env)).filter((name) => name.includes(".tmp"))).toEqual([]);
  });

  test("two writes that overlap both survive, so a renewal cannot drop what logout just wrote", async () => {
    const env = { HOME: createTempHome() };
    await writeCredential("cloudUrl", "https://app.acolyte.sh", env);

    // Started together, as renewal and a command touching credentials do inside one process: each
    // reads, edits and writes, so without ordering the second write is made from a stale read.
    await Promise.all([
      writeCredential("cloudToken", "tok_renewed", env),
      writeCredential("cloudRefreshToken", "ref_stored", env),
    ]);

    expect(readCredentialsSync(env)).toEqual({
      cloudUrl: "https://app.acolyte.sh",
      cloudToken: "tok_renewed",
      cloudRefreshToken: "ref_stored",
    });
  });

  test("removeCredentials drops every named key and leaves no staging file behind", async () => {
    const env = { HOME: createTempHome() };
    await writeCredential("cloudUrl", "https://app.acolyte.sh", env);
    await writeCredential("cloudToken", "tok_abc", env);
    await writeCredential("cloudRefreshToken", "ref_abc", env);
    await writeCredential("embeddingApiKey", "emb_abc", env);

    await removeCredentials(["cloudToken", "cloudRefreshToken", "cloudUrl"], env);

    expect(readCredentialsSync(env)).toEqual({ embeddingApiKey: "emb_abc" });
    expect(readdirSync(configDir(env)).filter((name) => name.includes(".tmp"))).toEqual([]);
  });

  test("removeCredential removes a single credential", async () => {
    const env = { HOME: createTempHome() };
    await writeCredential("cloudUrl", "https://cloud.example.com", env);
    await writeCredential("cloudToken", "tok_abc123", env);
    await removeCredential("cloudToken", env);
    const creds = readCredentialsSync(env);
    expect(creds).toEqual({ cloudUrl: "https://cloud.example.com" });
  });

  test("removeCredential deletes file when last credential removed", async () => {
    const home = createTempHome();
    const env = { HOME: home };
    await writeCredential("cloudToken", "tok_abc123", env);
    await removeCredential("cloudToken", env);
    expect(existsSync(join(configDir(env), "credentials"))).toBe(false);
  });

  test("readCredentialsSync reads file correctly", async () => {
    const env = { HOME: createTempHome() };
    await writeCredential("cloudToken", "tok_sync", env);
    const creds = readCredentialsSync(env);
    expect(creds).toEqual({ cloudToken: "tok_sync" });
  });

  test("readProviderApiKeysSync returns empty when no file exists", () => {
    expect(readProviderApiKeysSync({ HOME: "/nonexistent" })).toEqual({});
  });

  test("writeProviderApiKey stores and reads back a provider key", async () => {
    const env = { HOME: createTempHome() };
    await writeProviderApiKey("OPENAI_API_KEY", "sk-openai", env);
    expect(readProviderApiKeysSync(env)).toEqual({ OPENAI_API_KEY: "sk-openai" });
  });

  test("removeProviderApiKey removes a provider key and keeps siblings", async () => {
    const env = { HOME: createTempHome() };
    await writeProviderApiKey("OPENAI_API_KEY", "sk-openai", env);
    await writeProviderApiKey("ANTHROPIC_API_KEY", "sk-anthropic", env);
    await removeProviderApiKey("OPENAI_API_KEY", env);
    expect(readProviderApiKeysSync(env)).toEqual({ ANTHROPIC_API_KEY: "sk-anthropic" });
  });

  test("provider keys and cloud credentials share the file without clobbering", async () => {
    const env = { HOME: createTempHome() };
    await writeCredential("cloudToken", "tok_abc123", env);
    await writeProviderApiKey("AI_GATEWAY_API_KEY", "vck-1", env);
    await writeProviderApiKey("AI_GATEWAY_API_KEY", "vck-2", env);
    expect(readProviderApiKeysSync(env)).toEqual({ AI_GATEWAY_API_KEY: "vck-2" });
    expect(readCredentialsSync(env)).toEqual({ cloudToken: "tok_abc123" });
  });

  test("decodeTokenSubject extracts sub from JWT", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "user@example.com", scope: "user" })).toString("base64url");
    const token = `eyJhbGciOiJFZERTQSJ9.${payload}.fakesig`;
    expect(decodeTokenSubject(token)).toBe("user@example.com");
  });

  test("decodeTokenSubject returns undefined for invalid token", () => {
    expect(decodeTokenSubject("not-a-jwt")).toBeUndefined();
    expect(decodeTokenSubject("")).toBeUndefined();
  });

  test("credential file is written with 0o600 permissions", async () => {
    const home = createTempHome();
    const env = { HOME: home };
    await writeCredential("cloudToken", "tok_private", env);
    const filePath = join(configDir(env), "credentials");
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("ignores comments and blank lines", async () => {
    const env = { HOME: createTempHome() };
    const dir = configDir(env);
    mkdirSync(dir, { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "credentials"), "# comment\n\nACOLYTE_CLOUD_TOKEN=tok\n", "utf8");
    const creds = readCredentialsSync(env);
    expect(creds).toEqual({ cloudToken: "tok" });
  });
});
