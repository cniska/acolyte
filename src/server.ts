#!/usr/bin/env bun
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { runAgent } from "./agent";
import type { ChatRequest } from "./api";
import { appConfig, setPermissionMode } from "./app-config";
import { buildStreamErrorDetail } from "./error-handling";
import { errorToLogFields, log } from "./log";
import { mastraStorage, mastraStorageMode } from "./mastra-storage";
import { getObservationalMemoryConfig } from "./memory-config";
import { formatModel, isProviderAvailable, providerFromModel, resolveProvider } from "./provider-config";
import { createId } from "./short-id";
import { createSoulPrompt, getMemoryContextEntries } from "./soul";
import type { StreamErrorDetail } from "./stream-error";
import { extractToolErrorCode } from "./tool-error-codes";

const PORT = appConfig.server.port;
const API_KEY = appConfig.server.apiKey;
const OPENAI_API_KEY = appConfig.openai.apiKey;
const OPENAI_BASE_URL = appConfig.openai.baseUrl;
const omConfig = getObservationalMemoryConfig();
const SUPPRESSED_STDERR_PREFIX = "Upstream LLM API error from";
const SERVER_IDLE_TIMEOUT_SECONDS = Math.max(30, Math.ceil(appConfig.server.replyTimeoutMs / 1000) + 30);

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]): void => {
  const first = args[0];
  if (typeof first === "string" && first.includes(SUPPRESSED_STDERR_PREFIX)) return;
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
  return `err_${createId()}`;
}

function streamErrorPayload(error: unknown): { error: string; errorCode?: string; errorDetail?: StreamErrorDetail } {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  const extractedCode = extractToolErrorCode(errorMessage);
  const { errorCode, errorDetail } = buildStreamErrorDetail(
    {
      message: errorMessage,
      code: extractedCode,
      source: "server",
      unknownErrorCount: 1,
    },
    1,
  );
  return {
    error: errorMessage,
    errorCode,
    errorDetail,
  };
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
  const { errorCode, errorDetail } = buildStreamErrorDetail(
    {
      message: publicMessage,
      source: "server",
      unknownErrorCount: 1,
    },
    1,
  );
  log.error(message, {
    error_id: errorId,
    ...details,
    ...errorToLogFields(error),
  });
  return json({ error: publicMessage, errorId, errorCode, errorDetail }, status);
}

function isChatRequest(value: unknown): value is ChatRequest {
  if (!value || typeof value !== "object") return false;

  const req = value as Partial<ChatRequest>;
  return (
    typeof req.message === "string" &&
    typeof req.model === "string" &&
    Array.isArray(req.history) &&
    (req.sessionId === undefined || typeof req.sessionId === "string") &&
    (req.resourceId === undefined || typeof req.resourceId === "string") &&
    (req.useMemory === undefined || typeof req.useMemory === "boolean") &&
    (req.workspace === undefined || typeof req.workspace === "string")
  );
}

type WorkspaceResolution = {
  workspacePath: string;
  workspaceMode: "default" | "path";
};

function resolveWorkspacePath(request: Pick<ChatRequest, "workspace">): WorkspaceResolution {
  if (!request.workspace) return { workspacePath: resolve(process.cwd()), workspaceMode: "default" };
  const resolved = resolve(request.workspace);
  if (!existsSync(resolved)) throw new Error(`Workspace path does not exist: ${resolved}`);
  if (!statSync(resolved).isDirectory()) throw new Error(`Workspace path is not a directory: ${resolved}`);
  return { workspacePath: resolved, workspaceMode: "path" };
}

function hasValidAuth(req: Request): boolean {
  if (!API_KEY) return true;

  const auth = req.headers.get("authorization");
  return auth === `Bearer ${API_KEY}`;
}

function resolveResourceId(url: URL): string {
  const candidate = url.searchParams.get("resourceId")?.trim();
  if (candidate) return candidate;
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
  idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/v1/status" && req.method === "GET") {
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
      const memoryContextCount = (await getMemoryContextEntries()).length;
      return json({
        ok: true,
        provider,
        model: formatModel(model),
        permissions: appConfig.agent.permissions.mode,
        service: `http://localhost:${PORT}`,
        memory: memoryContextCount > 0 ? `${mastraStorageMode} (${memoryContextCount} entries)` : mastraStorageMode,
        observational_memory: `enabled (${omConfig.scope})`,
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
        if (!memoryStore) return json({ error: "Memory storage is not available." }, 501);
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
        if (!memoryStore) return json({ error: "Memory storage is not available." }, 501);
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
      if (mode !== "read" && mode !== "write") return badRequest("Invalid permission mode. Expected read or write.");
      setPermissionMode(mode);
      log.info("permission mode updated", {
        path: url.pathname,
        method: req.method,
        permission_mode: appConfig.agent.permissions.mode,
      });
      return json({ ok: true, permissionMode: appConfig.agent.permissions.mode });
    }

    const isChatJsonRoute = url.pathname === "/v1/chat" && req.method === "POST";
    const isChatStreamRoute = url.pathname === "/v1/chat/stream" && req.method === "POST";
    if (!isChatJsonRoute && !isChatStreamRoute) return new Response("Not Found", { status: 404 });

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

    let workspaceResolution: WorkspaceResolution;
    try {
      workspaceResolution = resolveWorkspacePath(chatRequest);
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : "Invalid workspace");
    }

    log.info("chat request started", {
      request_id: requestId,
      session_id: chatRequest.sessionId ?? null,
      model: chatRequest.model,
      history_messages: chatRequest.history.length,
      message_chars: chatRequest.message.length,
      has_resource_id: Boolean(chatRequest.resourceId),
      workspace_mode: workspaceResolution.workspaceMode,
    });
    if (isChatStreamRoute) {
      const encoder = new TextEncoder();
      let closed = false;
      const SSE_KEEPALIVE_INTERVAL_MS = 15_000;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (payload: Record<string, unknown>): void => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            } catch {
              closed = true;
            }
          };
          const keepaliveId = setInterval(() => {
            if (closed) {
              clearInterval(keepaliveId);
              return;
            }
            try {
              controller.enqueue(encoder.encode(":\n\n"));
            } catch {
              closed = true;
              clearInterval(keepaliveId);
            }
          }, SSE_KEEPALIVE_INTERVAL_MS);
          void (async () => {
            try {
              const soulPrompt = await createSoulPrompt();
              const reply = await runAgent({
                request: chatRequest,
                soulPrompt,
                workspace: workspaceResolution.workspacePath,
                onEvent: (event) => {
                  send(event);
                },
                onDebug: (entry) => {
                  log.info("agent debug", {
                    request_id: requestId,
                    session_id: chatRequest.sessionId ?? null,
                    event: entry.event,
                    sequence: entry.sequence,
                    phase_attempt: entry.phaseAttempt,
                    event_ts: entry.ts,
                    ...(entry.fields ?? {}),
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
                stream: true,
              });
              send({ type: "done", reply });
            } catch (error) {
              const payload = streamErrorPayload(error);
              log.error("chat stream failed", {
                request_id: requestId,
                session_id: chatRequest.sessionId ?? null,
                path: url.pathname,
                method: req.method,
                model: chatRequest.model,
                ...errorToLogFields(error),
              });
              send({ type: "error", ...payload });
            } finally {
              clearInterval(keepaliveId);
              if (!closed) {
                closed = true;
                try {
                  controller.close();
                } catch {
                  // Stream already closed by client disconnect or idle timeout.
                }
              }
            }
          })();
        },
        cancel() {
          closed = true;
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    try {
      const soulPrompt = await createSoulPrompt();
      const reply = await runAgent({
        request: chatRequest,
        soulPrompt,
        workspace: workspaceResolution.workspacePath,
        onDebug: (entry) => {
          log.info("agent debug", {
            request_id: requestId,
            session_id: chatRequest.sessionId ?? null,
            event: entry.event,
            sequence: entry.sequence,
            phase_attempt: entry.phaseAttempt,
            event_ts: entry.ts,
            ...(entry.fields ?? {}),
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
      return json(reply);
    } catch (error) {
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

process.on("uncaughtException", (error) => {
  log.error("uncaught exception", errorToLogFields(error));
});
process.on("unhandledRejection", (reason) => {
  log.error("unhandled rejection", errorToLogFields(reason instanceof Error ? reason : new Error(String(reason))));
});

log.info("Acolyte server listening", { url: `http://localhost:${server.port}` });
