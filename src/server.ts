#!/usr/bin/env bun
import type { ChatRequest } from "./api";
import { runAgent } from "./agent";

const PORT = Number(process.env.PORT ?? "8787");
const API_KEY = process.env.ACOLYTE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

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
    Array.isArray(req.history)
  );
}

function hasValidAuth(req: Request): boolean {
  if (!API_KEY) {
    return true;
  }

  const auth = req.headers.get("authorization");
  return auth === `Bearer ${API_KEY}`;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/healthz" && req.method === "GET") {
      return json({
        ok: true,
        service: "acolyte-backend",
        mode: OPENAI_API_KEY ? "openai" : "mock",
      });
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
      const reply = await runAgent({
        request: payload,
        openai: {
          apiKey: OPENAI_API_KEY,
          baseUrl: OPENAI_BASE_URL,
        },
      });
      return json(reply);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown backend error";
      return json({ error: message }, 502);
    }
  },
});

console.log(`Acolyte backend listening on http://localhost:${server.port}`);
