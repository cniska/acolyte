#!/usr/bin/env bun
import { runAgent } from "./agent";
import type { ChatRequest } from "./api";
import { appConfig, setPermissionMode } from "./app-config";
import { log } from "./log";
import { mastraStorage, mastraStorageMode } from "./mastra-storage";
import { getObservationalMemoryConfig } from "./memory-config";
import {
  isProviderAvailable,
  presentModel,
  presentRoleModels,
  providerFromModel,
  resolveProvider,
  resolveRoleModels,
} from "./provider-config";
import { createSoulPrompt, getMemoryContextEntries } from "./soul";

const PORT = appConfig.server.port;
const API_KEY = appConfig.server.apiKey;
const OPENAI_API_KEY = appConfig.openai.apiKey;
const OPENAI_BASE_URL = appConfig.openai.baseUrl;
const omConfig = getObservationalMemoryConfig();
const ERROR_ID_PREFIX = "err";

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

function serverError(
  message: string,
  error: unknown,
  details: Record<string, string | number | boolean | null | undefined>,
  status = 500,
): Response {
  const errorId = nextErrorId();
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  log.error(message, {
    error_id: errorId,
    error: errorMessage,
    ...details,
  });
  return json({ error: errorMessage, errorId }, status);
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
  const message = error instanceof Error ? error.message : "Unknown storage initialization error";
  log.error("failed to initialize Mastra storage", { error: message });
  process.exit(1);
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/healthz" && req.method === "GET") {
      const roleModels = resolveRoleModels();
      const providerConfig = {
        openaiApiKey: OPENAI_API_KEY,
        openaiBaseUrl: OPENAI_BASE_URL,
        anthropicApiKey: appConfig.anthropic.apiKey,
        googleApiKey: appConfig.google.apiKey,
      };
      const roleProviders = {
        main: providerFromModel(roleModels.main),
        planner: providerFromModel(roleModels.planner),
        coder: providerFromModel(roleModels.coder),
        reviewer: providerFromModel(roleModels.reviewer),
      };
      const roleProviderAvailability = {
        main: isProviderAvailable({ provider: roleProviders.main, ...providerConfig }),
        planner: isProviderAvailable({ provider: roleProviders.planner, ...providerConfig }),
        coder: isProviderAvailable({ provider: roleProviders.coder, ...providerConfig }),
        reviewer: isProviderAvailable({ provider: roleProviders.reviewer, ...providerConfig }),
      };
      const provider = roleProviderAvailability.main
        ? roleProviders.main === "openai"
          ? resolveProvider(OPENAI_API_KEY, OPENAI_BASE_URL)
          : roleProviders.main
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
        service: "acolyte-backend",
        provider,
        model: presentModel(roleModels.main),
        models: presentRoleModels(roleModels),
        providers: roleProviders,
        providerAvailability: roleProviderAvailability,
        apiBaseUrl: appConfig.openai.baseUrl,
        memory: {
          storage: mastraStorageMode,
          contextCount: memoryContextCount,
          resourceId: appConfig.memory.resourceId,
          observational: {
            enabled: true,
            scope: omConfig.scope,
            model: omConfig.model,
            observationTokens: omConfig.observation.messageTokens,
            reflectionTokens: omConfig.reflection.observationTokens,
            current: currentOm,
            currentError: currentOmError,
          },
        },
        permissionMode: appConfig.agent.permissions.mode,
      });
    }

    if (url.pathname === "/v1/admin/om/status" && req.method === "GET") {
      if (!hasValidAuth(req)) {
        return unauthorized();
      }
      try {
        const memoryStore = await mastraStorage.getStore("memory");
        if (!memoryStore) {
          return json({ error: "Memory storage is not available." }, 501);
        }
        const resourceId = resolveResourceId(url);
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
        return unauthorized();
      }
      try {
        const memoryStore = await mastraStorage.getStore("memory");
        if (!memoryStore) {
          return json({ error: "Memory storage is not available." }, 501);
        }
        const resourceId = resolveResourceId(url);
        await memoryStore.clearObservationalMemory(null, resourceId);
        return json({ ok: true, resourceId, wiped: true });
      } catch (error) {
        return serverError("om wipe failed", error, { path: url.pathname, method: req.method }, 500);
      }
    }

    if (url.pathname === "/v1/permissions" && req.method === "POST") {
      if (!hasValidAuth(req)) {
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
      return json({ ok: true, permissionMode: appConfig.agent.permissions.mode });
    }

    if (url.pathname !== "/v1/chat" || req.method !== "POST") {
      return new Response("Not Found", { status: 404 });
    }

    if (!hasValidAuth(req)) {
      return unauthorized();
    }

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    if (!isChatRequest(payload)) {
      return badRequest("Invalid request shape");
    }

    try {
      const soulPrompt = await createSoulPrompt();
      const reply = await runAgent({
        request: payload,
        soulPrompt,
      });
      return json(reply);
    } catch (error) {
      return serverError(
        "chat request failed",
        error,
        {
          path: url.pathname,
          method: req.method,
          session_id: (payload as ChatRequest).sessionId ?? null,
          model: (payload as ChatRequest).model,
        },
        502,
      );
    }
  },
});

log.info("Acolyte backend listening", { url: `http://localhost:${server.port}` });
