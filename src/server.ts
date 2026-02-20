#!/usr/bin/env bun
import type { ChatRequest, ChatResponse } from "./api";

const PORT = Number(process.env.PORT ?? "8787");
const API_KEY = process.env.ACOLYTE_API_KEY;

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

function buildReply(req: ChatRequest): ChatResponse {
  const prompt = req.message.trim();
  const lower = prompt.toLowerCase();

  if (lower.includes("summarize")) {
    const userCount = req.history.filter((m) => m.role === "user").length;
    const assistantCount = req.history.filter((m) => m.role === "assistant").length;
    return {
      model: req.model,
      output: `Summary: ${userCount} user messages and ${assistantCount} assistant messages in this session.`,
    };
  }

  return {
    model: req.model,
    output: [
      "Remote backend is active.",
      "This is the placeholder response contract for future Mastra integration.",
      `Echo: ${prompt}`,
    ].join(" "),
  };
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
      return json({ ok: true, service: "acolyte-backend" });
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

    return json(buildReply(payload));
  },
});

console.log(`acolyte backend listening on http://localhost:${server.port}`);

