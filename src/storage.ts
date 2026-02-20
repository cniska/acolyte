import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Session, SessionStore } from "./types";

const DATA_DIR = join(homedir(), ".acolyte");
const STORE_PATH = join(DATA_DIR, "sessions.json");

const EMPTY_STORE: SessionStore = { sessions: [] };

export async function readStore(): Promise<SessionStore> {
  if (!existsSync(STORE_PATH)) {
    return EMPTY_STORE;
  }

  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as SessionStore;
    return {
      sessions: parsed.sessions ?? [],
      activeSessionId: parsed.activeSessionId,
    };
  } catch {
    return EMPTY_STORE;
  }
}

export async function writeStore(store: SessionStore): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

export function createSession(model: string): Session {
  const now = new Date().toISOString();
  const id = `sess_${crypto.randomUUID()}`;
  return {
    id,
    createdAt: now,
    updatedAt: now,
    title: "New Session",
    model,
    messages: [],
  };
}
