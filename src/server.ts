#!/usr/bin/env bun
import type { ChatRequest, ChatResponse } from "./api";

const PORT = Number(process.env.PORT ?? "8787");
const API_KEY = process.env.ACOLYTE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const SYSTEM_PROMPT =
  "You are Acolyte, a pragmatic personal coding assistant. Be concise, accurate, and action-oriented.";

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

function buildMockReply(req: ChatRequest): ChatResponse {
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
      "No OPENAI_API_KEY configured, so mock mode is enabled.",
      `Echo: ${prompt}`,
    ].join(" "),
  };
}

function buildModelInput(req: ChatRequest): string {
  const recent = req.history.slice(-12);
  const lines = recent.map((msg) => `${msg.role.toUpperCase()}: ${msg.content.trim()}`);
  lines.push(`USER: ${req.message.trim()}`);
  return lines.join("\n");
}

function parseOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const withDirect = payload as { output_text?: unknown; output?: unknown };
  if (typeof withDirect.output_text === "string" && withDirect.output_text.trim().length > 0) {
    return withDirect.output_text.trim();
  }

  if (!Array.isArray(withDirect.output)) {
    return null;
  }

  for (const item of withDirect.output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const maybeContent = (item as { content?: unknown }).content;
    if (!Array.isArray(maybeContent)) {
      continue;
    }
    for (const chunk of maybeContent) {
      if (!chunk || typeof chunk !== "object") {
        continue;
      }
      const text = (chunk as { text?: unknown }).text;
      if (typeof text === "string" && text.trim().length > 0) {
        return text.trim();
      }
    }
  }

  return null;
}

async function buildReply(req: ChatRequest): Promise<ChatResponse> {
  if (!OPENAI_API_KEY) {
    return buildMockReply(req);
  }

  const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: req.model,
      input: buildModelInput(req),
      instructions: SYSTEM_PROMPT,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${body || "no body"}`);
  }

  const payload = await response.json();
  const output = parseOutputText(payload);
  if (!output) {
    throw new Error("OpenAI API returned no output text");
  }

  return {
    output,
    model: req.model,
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
      const reply = await buildReply(payload);
      return json(reply);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown backend error";
      return json({ error: message }, 502);
    }
  },
});

console.log(`acolyte backend listening on http://localhost:${server.port}`);
