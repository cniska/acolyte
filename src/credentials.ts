import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PRIVATE_FILE_MODE } from "./file-ops";
import { resolveHomeDir } from "./home-dir";

const CREDENTIALS_FILE = "credentials";

export type Credentials = {
  cloudUrl?: string;
  cloudToken?: string;
};

function credentialsPath(homeDir?: string): string {
  return join(homeDir ?? resolveHomeDir(), ".acolyte", CREDENTIALS_FILE);
}

function parse(content: string): Credentials {
  const creds: Credentials = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key === "ACOLYTE_CLOUD_URL" && value.length > 0) creds.cloudUrl = value;
    if (key === "ACOLYTE_CLOUD_TOKEN" && value.length > 0) creds.cloudToken = value;
  }
  return creds;
}

function serialize(creds: Credentials): string {
  const lines: string[] = [];
  if (creds.cloudUrl) lines.push(`ACOLYTE_CLOUD_URL=${creds.cloudUrl}`);
  if (creds.cloudToken) lines.push(`ACOLYTE_CLOUD_TOKEN=${creds.cloudToken}`);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function readCredentialsSync(homeDir?: string): Credentials {
  const path = credentialsPath(homeDir);
  if (!existsSync(path)) return {};
  try {
    return parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export async function readCredentials(homeDir?: string): Promise<Credentials> {
  const path = credentialsPath(homeDir);
  if (!existsSync(path)) return {};
  try {
    return parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

export async function writeCredential(key: keyof Credentials, value: string, homeDir?: string): Promise<void> {
  const path = credentialsPath(homeDir);
  const existing = await readCredentials(homeDir);
  existing[key] = value;
  const dir = join(homeDir ?? resolveHomeDir(), ".acolyte");
  await mkdir(dir, { recursive: true });
  await writeFile(path, serialize(existing), { encoding: "utf8", mode: PRIVATE_FILE_MODE });
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
  const existing = await readCredentials(homeDir);
  delete existing[key];
  const content = serialize(existing);
  if (content.length === 0) {
    try {
      await unlink(path);
    } catch {}
    return;
  }
  await writeFile(path, content, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
}
