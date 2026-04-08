import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  decodeTokenSubject,
  readCredentials,
  readCredentialsSync,
  removeCredential,
  writeCredential,
} from "./credentials";
import { tempDir } from "./test-utils";

const dirs = tempDir();
afterEach(dirs.cleanupDirs);

function createTempHome(): string {
  return dirs.createDir("creds-test-");
}

describe("credentials", () => {
  test("readCredentialsSync returns empty when no file exists", () => {
    expect(readCredentialsSync("/nonexistent")).toEqual({});
  });

  test("writeCredential creates file and readCredentials reads it", async () => {
    const home = createTempHome();
    await writeCredential("cloudToken", "tok_abc123", home);
    const creds = await readCredentials(home);
    expect(creds).toEqual({ cloudToken: "tok_abc123" });
  });

  test("writeCredential preserves existing credentials", async () => {
    const home = createTempHome();
    await writeCredential("cloudUrl", "https://cloud.example.com", home);
    await writeCredential("cloudToken", "tok_abc123", home);
    const creds = await readCredentials(home);
    expect(creds).toEqual({ cloudUrl: "https://cloud.example.com", cloudToken: "tok_abc123" });
  });

  test("writeCredential overwrites existing value", async () => {
    const home = createTempHome();
    await writeCredential("cloudToken", "old", home);
    await writeCredential("cloudToken", "new", home);
    const creds = await readCredentials(home);
    expect(creds).toEqual({ cloudToken: "new" });
  });

  test("removeCredential removes a single credential", async () => {
    const home = createTempHome();
    await writeCredential("cloudUrl", "https://cloud.example.com", home);
    await writeCredential("cloudToken", "tok_abc123", home);
    await removeCredential("cloudToken", home);
    const creds = await readCredentials(home);
    expect(creds).toEqual({ cloudUrl: "https://cloud.example.com" });
  });

  test("removeCredential deletes file when last credential removed", async () => {
    const home = createTempHome();
    await writeCredential("cloudToken", "tok_abc123", home);
    await removeCredential("cloudToken", home);
    expect(existsSync(join(home, ".acolyte", "credentials"))).toBe(false);
  });

  test("readCredentialsSync reads file correctly", async () => {
    const home = createTempHome();
    await writeCredential("cloudToken", "tok_sync", home);
    const creds = readCredentialsSync(home);
    expect(creds).toEqual({ cloudToken: "tok_sync" });
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
    await writeCredential("cloudToken", "tok_private", home);
    const filePath = join(home, ".acolyte", "credentials");
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("ignores comments and blank lines", async () => {
    const home = createTempHome();
    const dir = join(home, ".acolyte");
    mkdirSync(dir, { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "credentials"), "# comment\n\nACOLYTE_CLOUD_TOKEN=tok\n", "utf8");
    const creds = await readCredentials(home);
    expect(creds).toEqual({ cloudToken: "tok" });
  });
});
