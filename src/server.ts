#!/usr/bin/env bun
import type { ChatRequest } from "./api";
import { runAgent } from "./agent";
import { appConfig } from "./app-config";
import { mastraStorage, mastraStorageMode } from "./mastra-storage";
import { getObservationalMemoryConfig } from "./memory-config";
import { createSoulPrompt } from "./soul";

const PORT = appConfig.server.port;
const API_KEY = appConfig.server.apiKey;
const OPENAI_API_KEY = appConfig.openai.apiKey;
const OPENAI_BASE_URL = appConfig.openai.baseUrl;
const omConfig = getObservationalMemoryConfig();

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

function isChatRequest(value: unknown): value is ChatRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const req = value as Partial<ChatRequest>;
  return (
    typeof req.message === "string" &&
    typeof req.model === "string" &&
    Array.isArray(req.history) &&
    (req.sessionId === undefined || typeof req.sessionId === "string")
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
  console.error(`Failed to initialize Mastra storage: ${message}`);
  process.exit(1);
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/healthz" && req.method === "GET") {
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
          const history = await memoryStore.getObservationalMemoryHistory(
            null,
            appConfig.memory.resourceId,
            10,
          );
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

      return json({
        ok: true,
        service: "acolyte-backend",
        mode: OPENAI_API_KEY ? "openai" : "mock",
        memory: {
          storage: mastraStorageMode,
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
        const message = error instanceof Error ? error.message : "Failed to read OM status.";
        return json({ error: message }, 500);
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
        const message = error instanceof Error ? error.message : "Failed to wipe OM.";
        return json({ error: message }, 500);
      }
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
        openai: {
          apiKey: OPENAI_API_KEY,
          baseUrl: OPENAI_BASE_URL,
        },
        soulPrompt,
      });
      return json(reply);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown backend error";
      return json({ error: message }, 502);
    }
  },
});

console.log(`Acolyte backend listening on http://localhost:${server.port}`);
