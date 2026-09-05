import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { getDotenvValue, parseDotenv, removeDotenvKey, upsertDotenvValue } from "./dotenv";
import { PRIVATE_FILE_MODE } from "./file-ops";
import { configDir, type Env } from "./paths";
import { type ProviderApiEnvKey, providerApiEnvKeySchema } from "./provider-contract";

const CREDENTIALS_FILE = "credentials";

const KEY_MAP = {
  cloudUrl: "ACOLYTE_CLOUD_URL",
  cloudToken: "ACOLYTE_CLOUD_TOKEN",
  cloudRefreshToken: "ACOLYTE_CLOUD_REFRESH_TOKEN",
  embeddingApiKey: "ACOLYTE_EMBEDDING_API_KEY",
} as const;

export type Credentials = {
  cloudUrl?: string;
  cloudToken?: string;
  cloudRefreshToken?: string;
  embeddingApiKey?: string;
};

function credentialsPath(env?: Env): string {
  return join(configDir(env), CREDENTIALS_FILE);
}

function parseCredentials(content: string): Credentials {
  const entries = parseDotenv(content);
  const creds: Credentials = {};
  const url = getDotenvValue(entries, KEY_MAP.cloudUrl);
  const token = getDotenvValue(entries, KEY_MAP.cloudToken);
  const refreshToken = getDotenvValue(entries, KEY_MAP.cloudRefreshToken);
  if (url) creds.cloudUrl = url;
  if (token) creds.cloudToken = token;
  if (refreshToken) creds.cloudRefreshToken = refreshToken;
  const embeddingApiKey = getDotenvValue(entries, KEY_MAP.embeddingApiKey);
  if (embeddingApiKey) creds.embeddingApiKey = embeddingApiKey;
  return creds;
}

export function readCredentialsSync(env?: Env): Credentials {
  const path = credentialsPath(env);
  if (!existsSync(path)) return {};
  try {
    return parseCredentials(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Replaces the file in one step: a reader either sees the whole previous version or the whole next
 * one, never the empty window a truncating write leaves open. Renewal writes this file from every
 * running process, so that window would otherwise be reached by any process starting alongside one.
 */
async function writeCredentialsFile(next: string, env?: Env): Promise<void> {
  const path = credentialsPath(env);
  // Unique per write, not just per process: renewal can have two writes in flight at once, and a
  // shared staging path would let one rename the other's file out from under it.
  const staging = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(configDir(env), { recursive: true });
  await writeFile(staging, next, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  await chmod(staging, PRIVATE_FILE_MODE);
  try {
    await rename(staging, path);
  } catch (error) {
    await unlink(staging).catch(() => {});
    throw error;
  }
}

/**
 * Runs credential mutations one after another. Each is a read, an edit and a write, and renewal now
 * makes them from whatever turn is running — including while the user runs `logout`. Two that
 * overlap both read the same file and the second write drops whatever the first had just made.
 */
let pendingMutation: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = pendingMutation.then(work, work);
  pendingMutation = next.catch(() => {});
  return next;
}

async function upsertCredentialsEntry(envKey: string, value: string, env?: Env): Promise<void> {
  await serialized(async () => {
    let content = "";
    try {
      content = await readFile(credentialsPath(env), "utf8");
    } catch {}
    await writeCredentialsFile(upsertDotenvValue(content, envKey, value), env);
  });
}

/** Drops every named key in one write, so a concurrent renewal cannot land between two removals. */
async function removeCredentialsEntries(envKeys: string[], env?: Env): Promise<void> {
  await serialized(async () => {
    const path = credentialsPath(env);
    let content = "";
    try {
      content = await readFile(path, "utf8");
    } catch {
      return;
    }
    const next = envKeys.reduce((text, key) => removeDotenvKey(text, key), content);
    if (next.length === 0) {
      await unlink(path).catch(() => {});
      return;
    }
    await writeCredentialsFile(next, env);
  });
}

export async function writeCredential(key: keyof Credentials, value: string, env?: Env): Promise<void> {
  await upsertCredentialsEntry(KEY_MAP[key], value, env);
}

export function providerCredentialsPath(env?: Env): string {
  return credentialsPath(env);
}

export function readProviderApiKeysSync(env?: Env): Partial<Record<ProviderApiEnvKey, string>> {
  const path = credentialsPath(env);
  if (!existsSync(path)) return {};
  try {
    const entries = parseDotenv(readFileSync(path, "utf8"));
    const keys: Partial<Record<ProviderApiEnvKey, string>> = {};
    for (const envKey of providerApiEnvKeySchema.options) {
      const value = getDotenvValue(entries, envKey);
      if (value) keys[envKey] = value;
    }
    return keys;
  } catch {
    return {};
  }
}

export async function writeProviderApiKey(envKey: ProviderApiEnvKey, value: string, env?: Env): Promise<void> {
  await upsertCredentialsEntry(envKey, value, env);
}

export async function removeProviderApiKey(envKey: ProviderApiEnvKey, env?: Env): Promise<void> {
  await removeCredentialsEntries([envKey], env);
}

// The subject decides the user memory scope and gates sign-in, so the claim is validated rather than
// asserted. The signature is not checked: the cloud verifies that, and an expired token still names
// the same account.
const tokenClaimsSchema = z.object({ sub: z.string().min(1), exp: z.number().optional() });

function decodeTokenClaims(token: string): { sub: string; exp?: number } | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const claims = tokenClaimsSchema.safeParse(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
    return claims.success ? claims.data : undefined;
  } catch {
    return undefined;
  }
}

export function decodeTokenSubject(token: string): string | undefined {
  return decodeTokenClaims(token)?.sub;
}

/** Seconds since the epoch at which the token stops being accepted, when it says. */
export function decodeTokenExpiry(token: string): number | undefined {
  return decodeTokenClaims(token)?.exp;
}

export async function removeCredential(key: keyof Credentials, env?: Env): Promise<void> {
  await removeCredentialsEntries([KEY_MAP[key]], env);
}

export async function removeCredentials(keys: (keyof Credentials)[], env?: Env): Promise<void> {
  await removeCredentialsEntries(
    keys.map((key) => KEY_MAP[key]),
    env,
  );
}
