import type { ChatRequest, ChatResponse } from "./api";

const SYSTEM_PROMPT =
  "You are Acolyte, a pragmatic personal coding assistant. Be concise, accurate, and action-oriented.";

interface OpenAIClientConfig {
  apiKey?: string;
  baseUrl: string;
}

interface AgentContext {
  request: ChatRequest;
  openai: OpenAIClientConfig;
}

function buildModelInput(req: ChatRequest): string {
  const recent = req.history.slice(-16);
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

async function callOpenAI(input: {
  model: string;
  openai: OpenAIClientConfig;
  instructions: string;
  inputText: string;
}): Promise<string> {
  const { model, instructions, inputText } = input;
  const { apiKey, baseUrl } = input.openai;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions,
      input: inputText,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${body || "no body"}`);
  }

  const payload = await response.json();
  const text = parseOutputText(payload);
  if (!text) {
    throw new Error("OpenAI API returned no output text");
  }

  return text;
}

async function planStep(ctx: AgentContext): Promise<string> {
  if (!ctx.openai.apiKey) {
    return "1) Interpret request. 2) Give concise actionable response. 3) Validate against memory/context.";
  }

  const instructions = [
    "Create a short execution plan for answering the final user request.",
    "Return 2-5 numbered steps.",
    "No prose before or after the steps.",
  ].join(" ");

  return callOpenAI({
    model: ctx.request.model,
    openai: ctx.openai,
    instructions,
    inputText: buildModelInput(ctx.request),
  });
}

async function executeStep(ctx: AgentContext, plan: string): Promise<string> {
  if (!ctx.openai.apiKey) {
    return [
      "Remote backend is active.",
      "No OPENAI_API_KEY configured, so mock mode is enabled.",
      `Plan: ${plan}`,
      `Echo: ${ctx.request.message.trim()}`,
    ].join(" ");
  }

  const instructions = [
    SYSTEM_PROMPT,
    "Follow the execution plan provided below.",
    "Be concise and concrete. If uncertain, state what to verify.",
    "Execution plan:",
    plan,
  ].join("\n\n");

  return callOpenAI({
    model: ctx.request.model,
    openai: ctx.openai,
    instructions,
    inputText: buildModelInput(ctx.request),
  });
}

async function reviewStep(ctx: AgentContext, draft: string): Promise<string> {
  if (!ctx.openai.apiKey) {
    return draft;
  }

  const instructions = [
    "Review and improve the draft response.",
    "Keep factual claims grounded and concise.",
    "Return only the final revised response.",
  ].join(" ");

  const input = [
    `USER_REQUEST:\n${ctx.request.message.trim()}`,
    `DRAFT_RESPONSE:\n${draft}`,
  ].join("\n\n");

  return callOpenAI({
    model: ctx.request.model,
    openai: ctx.openai,
    instructions,
    inputText: input,
  });
}

export async function runAgent(input: {
  request: ChatRequest;
  openai: OpenAIClientConfig;
}): Promise<ChatResponse> {
  const context: AgentContext = {
    request: input.request,
    openai: input.openai,
  };

  const plan = await planStep(context);
  const draft = await executeStep(context, plan);
  const finalOutput = await reviewStep(context, draft);

  return {
    model: context.request.model,
    output: finalOutput,
  };
}
