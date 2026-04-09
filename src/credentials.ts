import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDotenvValue, parseDotenv, removeDotenvKey, upsertDotenvValue } from "./dotenv";
import { PRIVATE_FILE_MODE } from "./file-ops";
import { configDirFromHome } from "./paths";

const CREDENTIALS_FILE = "credentials";

const KEY_MAP = {
  cloudUrl: "ACOLYTE_CLOUD_URL",
  cloudToken: "ACOLYTE_CLOUD_TOKEN",
} as const;

export type Credentials = {
  cloudUrl?: string;
  cloudToken?: string;
};

function credentialsPath(homeDir?: string): string {
  return join(configDirFromHome(homeDir), CREDENTIALS_FILE);
}

function parseCredentials(content: string): Credentials {
  const entries = parseDotenv(content);
  const creds: Credentials = {};
  const url = getDotenvValue(entries, KEY_MAP.cloudUrl);
  const token = getDotenvValue(entries, KEY_MAP.cloudToken);
  if (url) creds.cloudUrl = url;
  if (token) creds.cloudToken = token;
  return creds;
}

export function readCredentialsSync(homeDir?: string): Credentials {
  const path = credentialsPath(homeDir);
  if (!existsSync(path)) return {};
  try {
    return parseCredentials(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export async function readCredentials(homeDir?: string): Promise<Credentials> {
  const path = credentialsPath(homeDir);
  if (!existsSync(path)) return {};
  try {
    return parseCredentials(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

export async function writeCredential(key: keyof Credentials, value: string, homeDir?: string): Promise<void> {
  const path = credentialsPath(homeDir);
  let content = "";
  try {
    content = await readFile(path, "utf8");
  } catch {}
  const next = upsertDotenvValue(content, KEY_MAP[key], value);
  const dir = configDirFromHome(homeDir);
  await mkdir(dir, { recursive: true });
  await writeFile(path, next, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  await chmod(path, PRIVATE_FILE_MODE);
}

export function decodeTokenSubject(token: string): string | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { sub?: string };
    return payload.sub;
  } catch {
    return undefined;
  }
}

export async function removeCredential(key: keyof Credentials, homeDir?: string): Promise<void> {
  const path = credentialsPath(homeDir);
  let content = "";
  try {
    content = await readFile(path, "utf8");
  } catch {
    return;
  }
  const next = removeDotenvKey(content, KEY_MAP[key]);
  if (next.length === 0) {
    try {
      await unlink(path);
    } catch {}
    return;
  }
  await writeFile(path, next, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  await chmod(path, PRIVATE_FILE_MODE);
}
