import type { ChatRequest } from "./api";
import { log } from "./log";
import type { RunChatHandlers, StatusPayload } from "./server-contract";

type ServerHttpDeps = {
  createStatusPayload: () => Promise<StatusPayload>;
  hasValidAuth: (req: Request, url?: URL) => boolean;
  isChatRequest: (value: unknown) => value is ChatRequest;
  runChatRequest: (chatRequest: ChatRequest, handlers: RunChatHandlers) => Promise<void>;
  serverError: (
    message: string,
    error: unknown,
    details: Record<string, string | number | boolean | null | undefined>,
    status?: number,
  ) => Response;
  shutdownServer: () => void;
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

export function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function warnUnauthorized(path: string, method: string): Response {
  log.warn("unauthorized request", { path, method });
  return unauthorized();
}

async function handleHealthz(ctx: RouteContext): Promise<Response | null> {
  if (ctx.url.pathname !== "/healthz" || ctx.req.method !== "GET") return null;
  return json({ ok: true });
}

async function handleStatus(ctx: RouteContext): Promise<Response | null> {
  if (ctx.url.pathname !== "/v1/status" || ctx.req.method !== "GET") return null;
  if (!ctx.deps.hasValidAuth(ctx.req, ctx.url)) return warnUnauthorized(ctx.url.pathname, ctx.req.method);
  return json(await ctx.deps.createStatusPayload());
}

async function handleShutdown(ctx: RouteContext): Promise<Response | null> {
  if (ctx.url.pathname !== "/v1/admin/shutdown" || ctx.req.method !== "POST") return null;
  if (!ctx.deps.hasValidAuth(ctx.req)) return warnUnauthorized(ctx.url.pathname, ctx.req.method);
  log.warn("server shutdown requested", { path: ctx.url.pathname, method: ctx.req.method });
  ctx.deps.shutdownServer();
  return json({ ok: true, shutdown: true });
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
    handleHealthz,
    handleStatus,
    handleShutdown,
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
