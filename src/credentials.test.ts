import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCredentials, readCredentialsSync, removeCredential, writeCredential } from "./credentials";

let tempDir: string;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

async function createTempHome(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "creds-test-"));
  return tempDir;
}

describe("credentials", () => {
  test("readCredentialsSync returns empty when no file exists", () => {
    expect(readCredentialsSync("/nonexistent")).toEqual({});
  });

  test("writeCredential creates file and readCredentials reads it", async () => {
    const home = await createTempHome();
    await writeCredential("cloudToken", "tok_abc123", home);
    const creds = await readCredentials(home);
    expect(creds).toEqual({ cloudToken: "tok_abc123" });
  });

  test("writeCredential preserves existing credentials", async () => {
    const home = await createTempHome();
    await writeCredential("cloudUrl", "https://cloud.example.com", home);
    await writeCredential("cloudToken", "tok_abc123", home);
    const creds = await readCredentials(home);
    expect(creds).toEqual({ cloudUrl: "https://cloud.example.com", cloudToken: "tok_abc123" });
  });

  test("writeCredential overwrites existing value", async () => {
    const home = await createTempHome();
    await writeCredential("cloudToken", "old", home);
    await writeCredential("cloudToken", "new", home);
    const creds = await readCredentials(home);
    expect(creds).toEqual({ cloudToken: "new" });
  });

  test("removeCredential removes a single credential", async () => {
    const home = await createTempHome();
    await writeCredential("cloudUrl", "https://cloud.example.com", home);
    await writeCredential("cloudToken", "tok_abc123", home);
    await removeCredential("cloudToken", home);
    const creds = await readCredentials(home);
    expect(creds).toEqual({ cloudUrl: "https://cloud.example.com" });
  });

  test("removeCredential deletes file when last credential removed", async () => {
    const home = await createTempHome();
    await writeCredential("cloudToken", "tok_abc123", home);
    await removeCredential("cloudToken", home);
    expect(existsSync(join(home, ".acolyte", "credentials"))).toBe(false);
  });

  test("readCredentialsSync reads file correctly", async () => {
    const home = await createTempHome();
    await writeCredential("cloudToken", "tok_sync", home);
    const creds = readCredentialsSync(home);
    expect(creds).toEqual({ cloudToken: "tok_sync" });
  });

  test("ignores comments and blank lines", async () => {
    const home = await createTempHome();
    const dir = join(home, ".acolyte");
    mkdirSync(dir, { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "credentials"), "# comment\n\nACOLYTE_CLOUD_TOKEN=tok\n", "utf8");
    const creds = await readCredentials(home);
    expect(creds).toEqual({ cloudToken: "tok" });
  });
});
