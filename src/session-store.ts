import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { t } from "./i18n";
import { log } from "./log";
import { dataDir } from "./paths";
import type { SessionStore } from "./session-contract";
import { type Session, type SessionId, type SessionState, sessionIdSchema, sessionSchema } from "./session-contract";
import { searchMessages } from "./session-ops";
import { createId } from "./short-id";

const DEFAULT_SESSION_STATE: SessionState = { sessions: [] };

const sessionEnvelopeSchema = z.object({
  sessions: z.array(z.unknown()).default([]),
  activeSessionId: z.unknown().optional(),
});

export function parseSessionState(input: unknown): SessionState {
  const envelope = sessionEnvelopeSchema.safeParse(input);
  if (!envelope.success) return DEFAULT_SESSION_STATE;
  const sessions: Session[] = [];
  for (const raw of envelope.data.sessions) {
    const parsed = sessionSchema.safeParse(raw);
    if (parsed.success) {
      sessions.push(parsed.data);
      continue;
    }
    // A malformed field must not drop the whole session — and must never (via the old
    // whole-store reset) drop every other session. The transcript is optional and
    // reconstructible from messages, so retry without it before giving up on the session.
    if (raw && typeof raw === "object" && "transcript" in raw) {
      const withoutTranscript = { ...(raw as Record<string, unknown>) };
      delete withoutTranscript.transcript;
      const salvaged = sessionSchema.safeParse(withoutTranscript);
      if (salvaged.success) {
        sessions.push(salvaged.data);
        continue;
      }
    }
    log.warn("session.parse.dropped", { error: parsed.error.message });
  }
  const activeSessionId = sessionIdSchema.safeParse(envelope.data.activeSessionId);
  return { sessions, activeSessionId: activeSessionId.success ? activeSessionId.data : undefined };
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
  const resolvedPath = storePath ?? join(dataDir(), "sessions.json");
  const resolvedDir = dirname(resolvedPath);

  // Serialize every read-modify-write so concurrent saves can't race the rename or
  // clobber each other's session (a lost update). Each mutation runs after the prior
  // one settles; a failed write doesn't stall the chain.
  let writeQueue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = writeQueue.then(op, op);
    writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function readState(): Promise<SessionState> {
    if (!existsSync(resolvedPath)) return { sessions: [], activeSessionId: undefined };
    try {
      const raw = await readFile(resolvedPath, "utf8");
      return parseSessionState(JSON.parse(raw));
    } catch {
      return { sessions: [], activeSessionId: undefined };
    }
  }

  async function writeState(state: SessionState): Promise<void> {
    await mkdir(resolvedDir, { recursive: true });
    // Unique temp name so a stray concurrent writer (another instance) can't have its
    // rename target pulled out from under it.
    const tmp = `${resolvedPath}.${process.pid}.${createId()}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await rename(tmp, resolvedPath);
  }

  return {
    async listSessions(options) {
      const state = await readState();
      const sorted = [...state.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const limit = options?.limit;
      return limit ? sorted.slice(0, limit) : sorted;
    },

    async getSession(id) {
      const state = await readState();
      return state.sessions.find((s) => s.id === id) ?? null;
    },

    saveSession(session) {
      return enqueue(async () => {
        const state = await readState();
        const idx = state.sessions.findIndex((s) => s.id === session.id);
        if (idx >= 0) {
          state.sessions[idx] = session;
        } else {
          state.sessions.unshift(session);
        }
        await writeState(state);
      });
    },

    removeSession(id) {
      return enqueue(async () => {
        const state = await readState();
        state.sessions = state.sessions.filter((s) => s.id !== id);
        if (state.activeSessionId === id) state.activeSessionId = undefined;
        await writeState(state);
      });
    },

    async getActiveSessionId() {
      const state = await readState();
      return state.activeSessionId;
    },

    setActiveSessionId(id) {
      return enqueue(async () => {
        const state = await readState();
        state.activeSessionId = id;
        await writeState(state);
      });
    },

    async searchSession(id, query, options) {
      const state = await readState();
      const session = state.sessions.find((s) => s.id === id);
      if (!session) return [];
      return searchMessages(session.messages, query, options);
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
  if (appConfig.features.cloudSync && appConfig.cloudUrl && appConfig.cloudToken) {
    const { getCloudClient } = await import("./cloud-client");
    return (await getCloudClient()).session;
  }
  return createFileSessionStore();
}
