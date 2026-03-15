import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { t } from "./i18n";
import { type Session, type SessionState, sessionStateSchema } from "./session-contract";
import type { SessionStore as SessionStorePort } from "./session-store";
import { createId } from "./short-id";

const DATA_DIR = join(homedir(), ".acolyte");
const STORE_PATH = join(DATA_DIR, "sessions.json");

const EMPTY_STORE: SessionState = { sessions: [] };

type LegacySessionTokenUsageEntry = {
  id?: unknown;
  usage?: {
    inputTokens?: unknown;
    outputTokens?: unknown;
    totalTokens?: unknown;
    inputBudgetTokens?: unknown;
    inputTruncated?: unknown;
    promptTokens?: unknown;
    completionTokens?: unknown;
    promptBudgetTokens?: unknown;
    promptTruncated?: unknown;
  };
  promptBreakdown?: unknown;

  modelCalls?: unknown;
};

function normalizeLegacyTokenUsageEntry(entry: unknown): unknown | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as LegacySessionTokenUsageEntry;
  if (!record.usage || typeof record.usage !== "object") return null;
  const usage = record.usage;
  if (
    typeof usage.inputTokens === "number" &&
    typeof usage.outputTokens === "number" &&
    typeof usage.totalTokens === "number"
  ) {
    return record;
  }
  if (
    typeof usage.promptTokens !== "number" ||
    typeof usage.completionTokens !== "number" ||
    typeof usage.totalTokens !== "number"
  ) {
    return null;
  }
  // TODO(cniska): Drop legacy session usage support at v1.0.0.
  return {
    ...record,
    usage: {
      inputTokens: usage.promptTokens,
      outputTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      ...(typeof usage.promptBudgetTokens === "number" ? { inputBudgetTokens: usage.promptBudgetTokens } : {}),
      ...(typeof usage.promptTruncated === "boolean" ? { inputTruncated: usage.promptTruncated } : {}),
    },
  };
}

export function normalizeStore(parsed: SessionState): SessionState {
  const normalized = {
    sessions: Array.isArray(parsed.sessions)
      ? parsed.sessions.map((session) => {
          const rawTokenUsage = Array.isArray((session as Partial<Session>).tokenUsage)
            ? ((session as Partial<Session>).tokenUsage as unknown[])
            : [];
          const tokenUsage = rawTokenUsage
            .map(normalizeLegacyTokenUsageEntry)
            .filter((entry): entry is Session["tokenUsage"][number] => entry !== null);
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
