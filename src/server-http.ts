import type { ChatRequest, ChatResponse } from "./api";
import { appConfig, setPermissionMode } from "./app-config";
import { log } from "./log";
import { mastraStorage } from "./mastra-storage";

type RunChatHandlers = {
  path: string;
  method: string;
  taskId?: string;
  onEvent: (event: Record<string, unknown>) => void;
  onDone: (reply: ChatResponse) => void;
  onError: (payload: { error: string; errorCode?: string; errorDetail?: unknown }) => void;
  isCancelled?: () => boolean;
  shouldYield?: () => boolean;
};

type ServerHttpDeps = {
  buildStatusPayload: () => Promise<Record<string, unknown>>;
  hasValidAuth: (req: Request, url?: URL) => boolean;
  isChatRequest: (value: unknown) => value is ChatRequest;
  resolveResourceId: (url: URL) => string;
  runChatRequest: (chatRequest: ChatRequest, handlers: RunChatHandlers) => Promise<void>;
  serverError: (
    message: string,
    error: unknown,
    details: Record<string, string | number | boolean | null | undefined>,
    status?: number,
  ) => Response;
  upgradeToRpc: (req: Request) => boolean;
};

type RouteContext = {
  req: Request;
  url: URL;
  deps: ServerHttpDeps;
};
type RouteHandler = (ctx: RouteContext) => Promise<Response | undefined | null>;

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

function warnUnauthorized(path: string, method: string): Response {
  log.warn("unauthorized request", { path, method });
  return unauthorized();
}

async function handleStatus(ctx: RouteContext): Promise<Response | null> {
  if (ctx.url.pathname !== "/v1/status" || ctx.req.method !== "GET") return null;
  return json(await ctx.deps.buildStatusPayload());
}

async function handleOmStatus(ctx: RouteContext): Promise<Response | null> {
  if (ctx.url.pathname !== "/v1/admin/om/status" || ctx.req.method !== "GET") return null;
  if (!ctx.deps.hasValidAuth(ctx.req)) return warnUnauthorized(ctx.url.pathname, ctx.req.method);

  try {
    const memoryStore = await mastraStorage.getStore("memory");
    if (!memoryStore) return json({ error: "Memory storage is not available." }, 501);
    const resourceId = ctx.deps.resolveResourceId(ctx.url);
    log.info("om status requested", { path: ctx.url.pathname, method: ctx.req.method, resource_id: resourceId });
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
    return ctx.deps.serverError("om status failed", error, { path: ctx.url.pathname, method: ctx.req.method }, 500);
  }
}

async function handleOmWipe(ctx: RouteContext): Promise<Response | null> {
  if (ctx.url.pathname !== "/v1/admin/om/wipe" || ctx.req.method !== "POST") return null;
  if (!ctx.deps.hasValidAuth(ctx.req)) return warnUnauthorized(ctx.url.pathname, ctx.req.method);

  try {
    const memoryStore = await mastraStorage.getStore("memory");
    if (!memoryStore) return json({ error: "Memory storage is not available." }, 501);
    const resourceId = ctx.deps.resolveResourceId(ctx.url);
    log.warn("om wipe requested", { path: ctx.url.pathname, method: ctx.req.method, resource_id: resourceId });
    await memoryStore.clearObservationalMemory(null, resourceId);
    log.info("om wipe completed", { path: ctx.url.pathname, method: ctx.req.method, resource_id: resourceId });
    return json({ ok: true, resourceId, wiped: true });
  } catch (error) {
    return ctx.deps.serverError("om wipe failed", error, { path: ctx.url.pathname, method: ctx.req.method }, 500);
  }
}

async function handlePermissions(ctx: RouteContext): Promise<Response | null> {
  if (ctx.url.pathname !== "/v1/permissions" || ctx.req.method !== "POST") return null;
  if (!ctx.deps.hasValidAuth(ctx.req)) return warnUnauthorized(ctx.url.pathname, ctx.req.method);

  let payload: unknown;
  try {
    payload = await ctx.req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const mode = (payload as { mode?: unknown })?.mode;
  if (mode !== "read" && mode !== "write") return badRequest("Invalid permission mode. Expected read or write.");
  setPermissionMode(mode);
  log.info("permission mode updated", {
    path: ctx.url.pathname,
    method: ctx.req.method,
    permission_mode: appConfig.agent.permissions.mode,
  });
  return json({ ok: true, permissionMode: appConfig.agent.permissions.mode });
}

async function handleRpcUpgrade(ctx: RouteContext): Promise<Response | undefined | null> {
  if (ctx.url.pathname !== "/v1/rpc") return null;
  if (!ctx.deps.hasValidAuth(ctx.req, ctx.url)) return warnUnauthorized(ctx.url.pathname, ctx.req.method);
  if (ctx.deps.upgradeToRpc(ctx.req)) return;
  return badRequest("WebSocket upgrade failed");
}

async function handleChatStream(ctx: RouteContext): Promise<Response | null> {
  if (!(ctx.url.pathname === "/v1/chat/stream" && ctx.req.method === "POST")) return null;
  if (!ctx.deps.hasValidAuth(ctx.req)) return warnUnauthorized(ctx.url.pathname, ctx.req.method);

  let payload: unknown;
  try {
    payload = await ctx.req.json();
  } catch {
    log.warn("invalid json body", { path: ctx.url.pathname, method: ctx.req.method });
    return badRequest("Invalid JSON body");
  }

  if (!ctx.deps.isChatRequest(payload)) {
    log.warn("invalid chat request shape", { path: ctx.url.pathname, method: ctx.req.method });
    return badRequest("Invalid request shape");
  }

  const chatRequest = payload as ChatRequest;
  const encoder = new TextEncoder();
  let closed = false;
  const SSE_KEEPALIVE_INTERVAL_MS = 15_000;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const closeControllerSafely = (): void => {
        try {
          controller.close();
        } catch {
          // Stream already closed by client disconnect or idle timeout.
        }
      };

      const send = (output: Record<string, unknown>): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(output)}\n\n`));
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
          await ctx.deps.runChatRequest(chatRequest, {
            path: ctx.url.pathname,
            method: ctx.req.method,
            onEvent: (event) => send(event),
            onDone: (reply) => send({ type: "done", reply }),
            onError: (errorPayload) => send({ type: "error", ...errorPayload }),
          });
        } finally {
          clearInterval(keepaliveId);
          if (!closed) {
            closed = true;
            closeControllerSafely();
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

export function createServerFetchHandler(deps: ServerHttpDeps): (req: Request) => Promise<Response | undefined> {
  const routeHandlers: RouteHandler[] = [
    handleStatus,
    handleOmStatus,
    handleOmWipe,
    handlePermissions,
    handleRpcUpgrade,
    handleChatStream,
  ];

  return async function fetch(req: Request): Promise<Response | undefined> {
    const ctx: RouteContext = { req, url: new URL(req.url), deps };

    for (const routeHandler of routeHandlers) {
      const response = await routeHandler(ctx);
      if (response !== null && response !== undefined) return response;
    }
    return new Response("Not Found", { status: 404 });
  };
}
