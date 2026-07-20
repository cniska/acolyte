import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PRIVATE_FILE_MODE } from "./file-ops";
import {
  OAUTH_STORE_VERSION,
  type OAuthProvider,
  type OAuthStore,
  type OAuthTokenSet,
  oauthStoreSchema,
} from "./oauth-store-contract";
import { configDir, type Env } from "./paths";

const OAUTH_FILE = "oauth.json";

function oauthPath(env?: Env): string {
  return join(configDir(env), OAUTH_FILE);
}

function readStore(env?: Env): OAuthStore {
  const path = oauthPath(env);
  if (!existsSync(path)) return { version: OAUTH_STORE_VERSION };
  try {
    const parsed = oauthStoreSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (parsed.success) return parsed.data;
  } catch {}
  return { version: OAUTH_STORE_VERSION };
}

async function writeStore(store: OAuthStore, env?: Env): Promise<void> {
  const path = oauthPath(env);
  await mkdir(configDir(env), { recursive: true });
  // Write + rename so a concurrent reader never observes a partially written token file.
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  await chmod(tmp, PRIVATE_FILE_MODE);
  await rename(tmp, path);
}

export function readOAuthTokensSync(provider: OAuthProvider, env?: Env): OAuthTokenSet | undefined {
  return readStore(env)[provider];
}

export async function writeOAuthTokens(provider: OAuthProvider, tokens: OAuthTokenSet, env?: Env): Promise<void> {
  const path = oauthPath(env);
  let store: OAuthStore = { version: OAUTH_STORE_VERSION };
  try {
    const parsed = oauthStoreSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    if (parsed.success) store = parsed.data;
  } catch {}
  await writeStore({ ...store, [provider]: tokens }, env);
}

export async function removeOAuthTokens(provider: OAuthProvider, env?: Env): Promise<void> {
  const path = oauthPath(env);
  let store: OAuthStore;
  try {
    const parsed = oauthStoreSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    if (!parsed.success) return;
    store = parsed.data;
  } catch {
    return;
  }
  if (store[provider] === undefined) return;
  const next = { ...store };
  delete next[provider];
  await writeStore(next, env);
}
