import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveHomeDir } from "./home-dir";
import { t } from "./i18n";
import { type Session, type SessionId, type SessionState, sessionStateSchema } from "./session-contract";
import type { SessionStore } from "./session-store";
import { createId } from "./short-id";

const DATA_DIR = join(resolveHomeDir(), ".acolyte");

const DEFAULT_SESSION_STATE: SessionState = { sessions: [] };

export function parseSessionState(input: SessionState): SessionState {
  const result = sessionStateSchema.safeParse(input);
  return result.success ? result.data : DEFAULT_SESSION_STATE;
}

export function createSession(model: string): Session {
  const now = new Date().toISOString();
  const id: SessionId = `sess_${createId()}`;
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

export function createFileSessionStore(storePath?: string): SessionStore {
  const resolvedPath = storePath ?? join(DATA_DIR, "sessions.json");
  const resolvedDir = dirname(resolvedPath);

  async function readState(): Promise<SessionState> {
    if (!existsSync(resolvedPath)) return { sessions: [], activeSessionId: undefined };
    try {
      const raw = await readFile(resolvedPath, "utf8");
      return parseSessionState(JSON.parse(raw) as SessionState);
    } catch {
      return { sessions: [], activeSessionId: undefined };
    }
  }

  async function writeState(state: SessionState): Promise<void> {
    await mkdir(resolvedDir, { recursive: true });
    await writeFile(resolvedPath, JSON.stringify(state, null, 2), "utf8");
  }

  return {
    async listSessions(options) {
      const state = await readState();
      const limit = options?.limit;
      return limit ? state.sessions.slice(0, limit) : state.sessions;
    },

    async getSession(id) {
      const state = await readState();
      return state.sessions.find((s) => s.id === id) ?? null;
    },

    async saveSession(session) {
      const state = await readState();
      const idx = state.sessions.findIndex((s) => s.id === session.id);
      if (idx >= 0) {
        state.sessions[idx] = session;
      } else {
        state.sessions.unshift(session);
      }
      await writeState(state);
    },

    async removeSession(id) {
      const state = await readState();
      state.sessions = state.sessions.filter((s) => s.id !== id);
      if (state.activeSessionId === id) state.activeSessionId = undefined;
      await writeState(state);
    },

    async getActiveSessionId() {
      const state = await readState();
      return state.activeSessionId;
    },

    async setActiveSessionId(id) {
      const state = await readState();
      state.activeSessionId = id;
      await writeState(state);
    },

    close() {},
  };
}

let storeInstance: SessionStore | null = null;
let storePromise: Promise<SessionStore> | null = null;

export function getSessionStore(): Promise<SessionStore> {
  if (storeInstance) return Promise.resolve(storeInstance);
  if (storePromise) return storePromise;

  storePromise = resolveStore().then((store) => {
    storeInstance = store;
    storePromise = null;
    process.on("exit", () => storeInstance?.close());
    return store;
  });
  return storePromise;
}

async function resolveStore(): Promise<SessionStore> {
  const { appConfig } = await import("./app-config");
  if (appConfig.features.postgresSessions) {
    const url = appConfig.postgresUrl;
    if (!url) throw new Error("postgresUrl required when features.postgresSessions is enabled");
    const { createPostgresSessionStore } = await import("./session-store-postgres");
    return createPostgresSessionStore(url);
  }
  return createFileSessionStore();
}
