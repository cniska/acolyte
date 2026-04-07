import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveHomeDir } from "./home-dir";
import { t } from "./i18n";
import { type Session, type SessionState, sessionStateSchema } from "./session-contract";
import type { SessionStore as SessionStorePort } from "./session-store";
import { createId } from "./short-id";

const DATA_DIR = join(resolveHomeDir(), ".acolyte");
const STORE_PATH = join(DATA_DIR, "sessions.json");

const DEFAULT_SESSION_STATE: SessionState = { sessions: [] };

export function parseSessionState(input: SessionState): SessionState {
  const result = sessionStateSchema.safeParse(input);
  return result.success ? result.data : DEFAULT_SESSION_STATE;
}

export async function readStore(): Promise<SessionState> {
  if (!existsSync(STORE_PATH)) return DEFAULT_SESSION_STATE;

  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as SessionState;
    return parseSessionState(parsed);
  } catch {
    return DEFAULT_SESSION_STATE;
  }
}

export async function writeStore(record: SessionState): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(record, null, 2), "utf8");
}

export function createSession(model: string): Session {
  const now = new Date().toISOString();
  const id = `sess_${createId()}`;
  return {
    id,
    createdAt: now,
    updatedAt: now,
    title: t("chat.session.default_title"),
    model,
    messages: [],
    tokenUsage: [],
  };
}

export const fileSessionStore: SessionStorePort = {
  readStore,
  writeStore,
  createSession,
};
