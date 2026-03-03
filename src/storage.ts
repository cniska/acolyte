import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Session, type SessionState, sessionStateSchema } from "./session-contract";
import type { SessionStore as SessionStorePort } from "./session-store";
import { createId } from "./short-id";

const DATA_DIR = join(homedir(), ".acolyte");
const STORE_PATH = join(DATA_DIR, "sessions.json");

const EMPTY_STORE: SessionState = { sessions: [] };

export function normalizeStore(parsed: SessionState): SessionState {
  const normalized = {
    sessions: Array.isArray(parsed.sessions)
      ? parsed.sessions.map((session) => {
          const tokenUsage = Array.isArray((session as Partial<Session>).tokenUsage)
            ? ((session as Partial<Session>).tokenUsage ?? [])
            : [];
          return { ...session, tokenUsage } as Session;
        })
      : [],
    activeSessionId: parsed.activeSessionId,
  };
  const result = sessionStateSchema.safeParse(normalized);
  return result.success ? result.data : EMPTY_STORE;
}

export async function readStore(): Promise<SessionState> {
  if (!existsSync(STORE_PATH)) return EMPTY_STORE;

  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as SessionState;
    return normalizeStore(parsed);
  } catch {
    return EMPTY_STORE;
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
    title: "New Session",
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
