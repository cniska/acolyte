#!/usr/bin/env bun
import { runAgent } from "./agent";
import type { ChatRequest } from "./api";
import { appConfig, setPermissionMode } from "./app-config";
import { errorToLogFields, log } from "./log";
import { mastraStorage, mastraStorageMode } from "./mastra-storage";
import { getObservationalMemoryConfig } from "./memory-config";
import { isProviderAvailable, presentModel, providerFromModel, resolveProvider } from "./provider-config";
import { createSoulPrompt, getMemoryContextEntries } from "./soul";

const PORT = appConfig.server.port;
const API_KEY = appConfig.server.apiKey;
const OPENAI_API_KEY = appConfig.openai.apiKey;
const OPENAI_BASE_URL = appConfig.openai.baseUrl;
const omConfig = getObservationalMemoryConfig();
const ERROR_ID_PREFIX = "err";
const CHAT_PROGRESS_TTL_MS = 5 * 60 * 1000;
const SUPPRESSED_STDERR_PREFIX = "Upstream LLM API error from";

type ChatProgressState = {
  requestId: string;
  sessionId: string;
  done: boolean;
  updatedAt: number;
  nextSeq: number;
  events: Array<{
    seq: number;
    message: string;
    kind: "status" | "tool" | "error";
    toolCallId?: string;
    toolName?: string;
    phase?: "start" | "result" | "error" | "chunk_start" | "chunk_delta" | "chunk_end";
  }>;
};

const chatProgressBySession = new Map<string, ChatProgressState>();

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]): void => {
  const first = args[0];
  if (typeof first === "string" && first.includes(SUPPRESSED_STDERR_PREFIX)) {
    return;
  }
  originalConsoleError(...args);
};

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

function badRequest(message: string): Response {
  return new Response(message, { status: 400 });
}

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function nextErrorId(): string {
  return `${ERROR_ID_PREFIX}_${crypto.randomUUID().slice(0, 8)}`;
}

function cleanupChatProgress(now = Date.now()): void {
  for (const [sessionId, state] of chatProgressBySession.entries()) {
    if (now - state.updatedAt > CHAT_PROGRESS_TTL_MS) {
      chatProgressBySession.delete(sessionId);
    }
  }
}

function startChatProgress(sessionId: string, requestId: string): void {
  cleanupChatProgress();
  chatProgressBySession.set(sessionId, {
    requestId,
    sessionId,
    done: false,
    updatedAt: Date.now(),
    nextSeq: 1,
    events: [],
  });
}

function progressKindForMessage(message: string): "status" | "tool" | "error" {
  if (/^tool failed:/i.test(message)) {
    return "error";
  }
  if (/^(working|thinking|planning|coding|reviewing|summarizing)[.…]/i.test(message)) {
    return "status";
  }
  return "tool";
}

function normalizeProgressMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return "";
  }
  // Normalize common tool-name variants so client rendering is stable.
  const aliases: Array<[RegExp, string]> = [
    [/^ReadFile\b/i, "Read"],
    [/^WriteFile\b/i, "Write"],
    [/^EditFile\b/i, "Edit"],
    [/^DeleteFile\b/i, "Delete"],
  ];
  for (const [pattern, replacement] of aliases) {
    if (pattern.test(trimmed)) {
      return trimmed.replace(pattern, replacement);
    }
  }
  return trimmed;
}

function appendChatProgress(
  sessionId: string,
  progress:
    | string
    | {
        message: string;
        kind?: "status" | "tool" | "error";
        toolCallId?: string;
        toolName?: string;
        phase?: "start" | "result" | "error" | "chunk_start" | "chunk_delta" | "chunk_end";
      },
): void {
  const state = chatProgressBySession.get(sessionId);
  if (!state) {
    return;
  }
  const rawMessage = typeof progress === "string" ? progress : progress.message;
  const trimmed = normalizeProgressMessage(rawMessage);
  if (!trimmed) {
    return;
  }
  const previous = state.events[state.events.length - 1];
  const kind =
    typeof progress === "string" ? progressKindForMessage(trimmed) : (progress.kind ?? progressKindForMessage(trimmed));
  const toolCallId = typeof progress === "string" ? undefined : progress.toolCallId?.trim() || undefined;
  const toolName = typeof progress === "string" ? undefined : progress.toolName?.trim() || undefined;
  const phase = typeof progress === "string" ? undefined : progress.phase;
  if (
    previous?.message === trimmed &&
    previous.kind === kind &&
    previous.toolCallId === toolCallId &&
    previous.toolName === toolName &&
    previous.phase === phase
  ) {
    return;
  }
  state.events.push({
    seq: state.nextSeq,
    message: trimmed,
    kind,
    toolCallId,
    toolName,
    phase,
  });
  state.nextSeq += 1;
  state.updatedAt = Date.now();
}

function completeChatProgress(sessionId: string): void {
  const state = chatProgressBySession.get(sessionId);
  if (!state) {
    return;
  }
  state.done = true;
  state.updatedAt = Date.now();
}

function serverError(
  message: string,
  error: unknown,
  details: Record<string, string | number | boolean | null | undefined>,
  status = 500,
): Response {
  const errorId = nextErrorId();
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  const errorMessageLower = errorMessage.toLowerCase();
  const publicMessage =
    errorMessageLower.includes("insufficient_quota") || errorMessageLower.includes("exceeded your current quota")
      ? "Provider quota exceeded. Add billing/credits or switch model/provider."
      : errorMessage;
  log.error(message, {
    error_id: errorId,
    ...details,
    ...errorToLogFields(error),
  });
  return json({ error: publicMessage, errorId }, status);
}

function isChatRequest(value: unknown): value is ChatRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const req = value as Partial<ChatRequest>;
  return (
    typeof req.message === "string" &&
    typeof req.model === "string" &&
    Array.isArray(req.history) &&
    (req.sessionId === undefined || typeof req.sessionId === "string") &&
    (req.resourceId === undefined || typeof req.resourceId === "string")
  );
}

function hasValidAuth(req: Request): boolean {
  if (!API_KEY) {
    return true;
  }

  const auth = req.headers.get("authorization");
  return auth === `Bearer ${API_KEY}`;
}

function resolveResourceId(url: URL): string {
  const candidate = url.searchParams.get("resourceId")?.trim();
  if (candidate) {
    return candidate;
  }
  return appConfig.memory.resourceId;
}

try {
  await mastraStorage.init();
} catch (error) {
  log.error("failed to initialize Mastra storage", {
    ...errorToLogFields(error),
  });
  process.exit(1);
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/healthz" && req.method === "GET") {
      const model = appConfig.model;
      const providerConfig = {
        openaiApiKey: OPENAI_API_KEY,
        openaiBaseUrl: OPENAI_BASE_URL,
        anthropicApiKey: appConfig.anthropic.apiKey,
        googleApiKey: appConfig.google.apiKey,
      };
      const modelProvider = providerFromModel(model);
      const providerReady = isProviderAvailable({ provider: modelProvider, ...providerConfig });
      const provider = providerReady
        ? modelProvider === "openai"
          ? resolveProvider(OPENAI_API_KEY, OPENAI_BASE_URL)
          : modelProvider
        : "mock";
      let currentOm: {
        exists: boolean;
        generationCount: number;
        lastObservedAt: Date | null;
        lastReflectionAt: Date | null;
      } = {
        exists: false,
        generationCount: 0,
        lastObservedAt: null,
        lastReflectionAt: null,
      };
      let currentOmError: string | undefined;
      try {
        const memoryStore = await mastraStorage.getStore("memory");
        if (memoryStore) {
          const current = await memoryStore.getObservationalMemory(null, appConfig.memory.resourceId);
          const history = await memoryStore.getObservationalMemoryHistory(null, appConfig.memory.resourceId, 10);
          const latestReflection = history.find((row) => row.originType === "reflection");
          currentOm = {
            exists: Boolean(current),
            generationCount: current?.generationCount ?? 0,
            lastObservedAt: current?.lastObservedAt ?? null,
            lastReflectionAt: latestReflection?.createdAt ?? null,
          };
        }
      } catch (error) {
        currentOmError = error instanceof Error ? error.message : "Failed to read OM state.";
      }

      const memoryContextCount = (await getMemoryContextEntries()).length;
      return json({
        ok: true,
        provider: {
          status: provider,
          api_url: appConfig.openai.baseUrl,
        },
        model: {
          status: presentModel(model),
        },
        provider_ready: providerReady,
        service: {
          status: "acolyte-backend",
          url: `http://localhost:${PORT}`,
        },
        memory: {
          status: mastraStorageMode,
          entries: memoryContextCount,
          resource_id: appConfig.memory.resourceId,
        },
        om: {
          status: "enabled",
          scope: omConfig.scope,
          model: omConfig.model,
          tokens: {
            obs: omConfig.observation.messageTokens,
            ref: omConfig.reflection.observationTokens,
          },
          state: {
            exists: currentOm.exists,
            gen: currentOm.generationCount,
          },
          last_observed: currentOm.lastObservedAt,
          last_reflection: currentOm.lastReflectionAt,
          error: currentOmError,
        },
        permissions: appConfig.agent.permissions.mode,
      });
    }

    if (url.pathname === "/v1/admin/om/status" && req.method === "GET") {
      if (!hasValidAuth(req)) {
        log.warn("unauthorized request", {
          path: url.pathname,
          method: req.method,
        });
        return unauthorized();
      }
      try {
        const memoryStore = await mastraStorage.getStore("memory");
        if (!memoryStore) {
          return json({ error: "Memory storage is not available." }, 501);
        }
        const resourceId = resolveResourceId(url);
        log.info("om status requested", {
          path: url.pathname,
          method: req.method,
          resource_id: resourceId,
        });
        const current = await memoryStore.getObservationalMemory(null, resourceId);
        const history = await memoryStore.getObservationalMemoryHistory(null, resourceId, 10);
        const latestReflection = history.find((row) => row.originType === "reflection");
        const observations =
          current?.activeObservations
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0) ?? [];
        return json({
          ok: true,
          resourceId,
          exists: Boolean(current),
          generationCount: current?.generationCount ?? 0,
          lastObservedAt: current?.lastObservedAt ?? null,
          lastReflectionAt: latestReflection?.createdAt ?? null,
          observations: observations.slice(0, 5),
          historyCount: history.length,
        });
      } catch (error) {
        return serverError("om status failed", error, { path: url.pathname, method: req.method }, 500);
      }
    }

    if (url.pathname === "/v1/admin/om/wipe" && req.method === "POST") {
      if (!hasValidAuth(req)) {
        log.warn("unauthorized request", {
          path: url.pathname,
          method: req.method,
        });
        return unauthorized();
      }
      try {
        const memoryStore = await mastraStorage.getStore("memory");
        if (!memoryStore) {
          return json({ error: "Memory storage is not available." }, 501);
        }
        const resourceId = resolveResourceId(url);
        log.warn("om wipe requested", {
          path: url.pathname,
          method: req.method,
          resource_id: resourceId,
        });
        await memoryStore.clearObservationalMemory(null, resourceId);
        log.info("om wipe completed", {
          path: url.pathname,
          method: req.method,
          resource_id: resourceId,
        });
        return json({ ok: true, resourceId, wiped: true });
      } catch (error) {
        return serverError("om wipe failed", error, { path: url.pathname, method: req.method }, 500);
      }
    }

    if (url.pathname === "/v1/permissions" && req.method === "POST") {
      if (!hasValidAuth(req)) {
        log.warn("unauthorized request", {
          path: url.pathname,
          method: req.method,
        });
        return unauthorized();
      }
      let payload: unknown;
      try {
        payload = await req.json();
      } catch {
        return badRequest("Invalid JSON body");
      }
      const mode = (payload as { mode?: unknown })?.mode;
      if (mode !== "read" && mode !== "write") {
        return badRequest("Invalid permission mode. Expected read or write.");
      }
      setPermissionMode(mode);
      log.info("permission mode updated", {
        path: url.pathname,
        method: req.method,
        permission_mode: appConfig.agent.permissions.mode,
      });
      return json({ ok: true, permissionMode: appConfig.agent.permissions.mode });
    }

    if (url.pathname === "/v1/chat/progress" && req.method === "GET") {
      if (!hasValidAuth(req)) {
        log.warn("unauthorized request", {
          path: url.pathname,
          method: req.method,
        });
        return unauthorized();
      }
      const sessionId = url.searchParams.get("sessionId")?.trim();
      if (!sessionId) {
        return badRequest("Missing sessionId");
      }
      const afterSeq = Number.parseInt(url.searchParams.get("afterSeq") ?? "0", 10);
      const state = chatProgressBySession.get(sessionId);
      if (!state) {
        return new Response("Not Found", { status: 404 });
      }
      const minSeq = Number.isFinite(afterSeq) ? Math.max(0, afterSeq) : 0;
      if (minSeq > 0) {
        state.events = state.events.filter((entry) => entry.seq > minSeq);
      }
      const events = state.events.filter((entry) => entry.seq > minSeq);
      return json({
        ok: true,
        sessionId: state.sessionId,
        requestId: state.requestId,
        done: state.done,
        events,
      });
    }

    if (url.pathname !== "/v1/chat" || req.method !== "POST") {
      return new Response("Not Found", { status: 404 });
    }

    if (!hasValidAuth(req)) {
      log.warn("unauthorized request", {
        path: url.pathname,
        method: req.method,
      });
      return unauthorized();
    }

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      log.warn("invalid json body", {
        path: url.pathname,
        method: req.method,
      });
      return badRequest("Invalid JSON body");
    }

    if (!isChatRequest(payload)) {
      log.warn("invalid chat request shape", {
        path: url.pathname,
        method: req.method,
      });
      return badRequest("Invalid request shape");
    }

    const requestId = nextErrorId();
    const startedAt = Date.now();
    const chatRequest = payload as ChatRequest;
    log.info("chat request started", {
      request_id: requestId,
      session_id: chatRequest.sessionId ?? null,
      model: chatRequest.model,
      history_messages: chatRequest.history.length,
      message_chars: chatRequest.message.length,
      has_resource_id: Boolean(chatRequest.resourceId),
    });
    if (chatRequest.sessionId) {
      startChatProgress(chatRequest.sessionId, requestId);
    }

    try {
      const soulPrompt = await createSoulPrompt();
      const reply = await runAgent({
        request: chatRequest,
        soulPrompt,
        onProgress: (message) => {
          if (chatRequest.sessionId) {
            appendChatProgress(chatRequest.sessionId, message);
          }
        },
        onDebug: (event, fields) => {
          log.info("agent debug", {
            request_id: requestId,
            session_id: chatRequest.sessionId ?? null,
            event,
            ...(fields ?? {}),
          });
        },
      });
      const durationMs = Date.now() - startedAt;
      log.info("chat request completed", {
        request_id: requestId,
        session_id: chatRequest.sessionId ?? null,
        model: reply.model,
        duration_ms: durationMs,
        model_calls: reply.modelCalls ?? null,
        tool_count: reply.toolCalls?.length ?? 0,
        tools: reply.toolCalls?.join(",") ?? "",
        prompt_tokens: reply.usage?.promptTokens ?? null,
        completion_tokens: reply.usage?.completionTokens ?? null,
      });
      if (chatRequest.sessionId) {
        completeChatProgress(chatRequest.sessionId);
      }
      return json(reply);
    } catch (error) {
      if (chatRequest.sessionId) {
        completeChatProgress(chatRequest.sessionId);
      }
      return serverError(
        "chat request failed",
        error,
        {
          request_id: requestId,
          path: url.pathname,
          method: req.method,
          session_id: chatRequest.sessionId ?? null,
          model: chatRequest.model,
        },
        502,
      );
    }
  },
});

log.info("Acolyte backend listening", { url: `http://localhost:${server.port}` });
