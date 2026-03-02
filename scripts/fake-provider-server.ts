type FakeProviderServer = {
  baseUrl: string;
  snapshot: () => { byScenario: Record<string, number> };
  stop: () => void;
};

const debugEnabled = process.env.ACOLYTE_FAKE_PROVIDER_DEBUG === "1";

type ResponseRequest = {
  model?: string;
  input?: unknown;
  previous_response_id?: string;
  tools?: Array<{ type?: string; name?: string }>;
};

type ScenarioId = "quick-answer" | "read-summarize" | "redundancy-guard-probe";
type Phase = "start" | "await_tools" | "done";

type ConversationState = {
  scenario: ScenarioId;
  phase: Phase;
  pendingCallIds: Set<string>;
  attempts: number;
  readToolName: string;
};

type FunctionCallOutput = { callId: string };

function s(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function responseId(counter: number): string {
  return `resp_${counter.toString().padStart(5, "0")}`;
}

function extractSourceText(input: unknown): string {
  return JSON.stringify(input ?? "").toLowerCase();
}

function detectScenario(sourceText: string): ScenarioId {
  if (sourceText.includes("[bench:read-summarize]")) return "read-summarize";
  if (sourceText.includes("[bench:redundancy-guard-probe]")) return "redundancy-guard-probe";
  return "quick-answer";
}

function extractFunctionCallOutputs(input: unknown): FunctionCallOutput[] {
  if (!Array.isArray(input)) return [];
  const outputs: FunctionCallOutput[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const type = s((item as { type?: unknown }).type);
    if (type !== "function_call_output") continue;
    const callId = s((item as { call_id?: unknown }).call_id).trim();
    if (!callId) continue;
    outputs.push({ callId });
  }
  return outputs;
}

function pickReadToolName(tools: ResponseRequest["tools"]): string {
  if (!Array.isArray(tools)) return "read-file";
  const functionNames = tools
    .filter((tool) => tool && typeof tool === "object" && s(tool.type) === "function")
    .map((tool) => s(tool?.name).trim())
    .filter((name) => name.length > 0);
  const exact = functionNames.find((name) => name === "read-file");
  if (exact) return exact;
  const fuzzy = functionNames.find((name) => name.includes("read"));
  return fuzzy ?? "read-file";
}

function responsesMessagePayload(model: string, idCounter: number, text: string): Record<string, unknown> {
  const ts = Math.floor(Date.now() / 1000);
  return {
    id: responseId(idCounter),
    object: "response",
    created_at: ts,
    status: "completed",
    error: null,
    model,
    output: [
      {
        id: `msg_${idCounter}`,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: {
      input_tokens: 1,
      output_tokens: Math.max(1, Math.ceil(text.length / 4)),
      total_tokens: Math.max(2, Math.ceil(text.length / 4) + 1),
    },
  };
}

function responsesToolCallsPayload(
  model: string,
  idCounter: number,
  calls: Array<{ id: string; callId: string; name: string; args: string }>,
): Record<string, unknown> {
  const ts = Math.floor(Date.now() / 1000);
  return {
    id: responseId(idCounter),
    object: "response",
    created_at: ts,
    status: "completed",
    error: null,
    model,
    output: calls.map((call) => ({
      type: "function_call",
      id: call.id,
      call_id: call.callId,
      name: call.name,
      arguments: call.args,
      status: "completed",
    })),
    usage: {
      input_tokens: 1,
      output_tokens: calls.length,
      total_tokens: calls.length + 1,
    },
  };
}

function parseResponsesRequest(raw: string): ResponseRequest {
  try {
    const parsed = JSON.parse(raw) as ResponseRequest;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function initialState(request: ResponseRequest): ConversationState {
  const scenario = detectScenario(extractSourceText(request.input));
  return {
    scenario,
    phase: "start",
    pendingCallIds: new Set<string>(),
    attempts: 0,
    readToolName: pickReadToolName(request.tools),
  };
}

function messageForScenario(state: ConversationState): string {
  if (state.scenario === "quick-answer") return "ok";
  if (state.scenario === "read-summarize") return "- scripts: test, verify\n- package manager: bun";
  return "Done.";
}

function nextPayload(model: string, responseCounter: number, state: ConversationState, outputs: FunctionCallOutput[]) {
  const seen = new Set(outputs.map((item) => item.callId));

  if (state.scenario === "quick-answer") {
    state.phase = "done";
    return responsesMessagePayload(model, responseCounter, messageForScenario(state));
  }

  if (state.phase === "start") {
    state.phase = "await_tools";
    if (state.scenario === "read-summarize") {
      state.pendingCallIds = new Set(["call_read_pkg"]);
      return responsesToolCallsPayload(model, responseCounter, [
        {
          id: "fc_read_pkg",
          callId: "call_read_pkg",
          name: state.readToolName,
          args: JSON.stringify({ paths: [{ path: "package.json" }] }),
        },
      ]);
    }

    state.pendingCallIds = new Set(["call_read_1", "call_read_2", "call_read_3"]);
    const args = JSON.stringify({ paths: [{ path: "src/lifecycle.ts" }] });
    return responsesToolCallsPayload(model, responseCounter, [
      { id: "fc_read_1", callId: "call_read_1", name: state.readToolName, args },
      { id: "fc_read_2", callId: "call_read_2", name: state.readToolName, args },
      { id: "fc_read_3", callId: "call_read_3", name: state.readToolName, args },
    ]);
  }

  if (state.phase === "await_tools") {
    const missing = [...state.pendingCallIds].filter((callId) => !seen.has(callId));
    if (missing.length === 0 || state.attempts >= 2) {
      state.phase = "done";
      return responsesMessagePayload(model, responseCounter, messageForScenario(state));
    }

    state.attempts += 1;
    return responsesToolCallsPayload(
      model,
      responseCounter,
      missing.map((callId) => ({
        id: `fc_retry_${callId}`,
        callId,
        name: state.readToolName,
        args: JSON.stringify({ paths: [{ path: callId === "call_read_pkg" ? "package.json" : "src/lifecycle.ts" }] }),
      })),
    );
  }

  return responsesMessagePayload(model, responseCounter, messageForScenario(state));
}

export function startFakeProviderServer(): FakeProviderServer {
  let responseCounter = 0;
  let conversationCounter = 0;
  const conversations = new Map<string, ConversationState>();
  const responseToConversation = new Map<string, string>();
  const byScenario: Record<string, number> = Object.create(null);

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/v1/responses" || req.method !== "POST")
        return new Response(JSON.stringify({ error: { message: "Not found" } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });

      const bodyText = await req.text();
      const body = parseResponsesRequest(bodyText);
      const model = s(body.model).trim() || "gpt-5-mini";
      const outputs = extractFunctionCallOutputs(body.input);

      const previous = s(body.previous_response_id).trim();
      const existingConversationId = previous ? responseToConversation.get(previous) : undefined;
      const conversationId = existingConversationId ?? `conv_${++conversationCounter}`;
      const state = conversations.get(conversationId) ?? initialState(body);
      conversations.set(conversationId, state);
      byScenario[state.scenario] = (byScenario[state.scenario] ?? 0) + 1;

      responseCounter += 1;
      const payload = nextPayload(model, responseCounter, state, outputs);
      responseToConversation.set(s(payload.id), conversationId);

      if (debugEnabled) {
        const sourcePreview = extractSourceText(body.input).slice(0, 180).replace(/\s+/g, " ");
        console.error(
          `[fake-provider] conv=${conversationId} req=${responseCounter} prev=${previous || "-"} scenario=${state.scenario} phase=${state.phase} outputs=${outputs.length} source=${sourcePreview}`,
        );
      }

      return Response.json(payload);
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    snapshot: () => ({ byScenario: { ...byScenario } }),
    stop: () => server.stop(true),
  };
}

export async function withFakeProviderServer<T>(
  fn: (baseUrl: string, controls: { snapshot: () => { byScenario: Record<string, number> } }) => Promise<T>,
): Promise<T> {
  const fake = startFakeProviderServer();
  try {
    return await fn(fake.baseUrl, { snapshot: fake.snapshot });
  } finally {
    fake.stop();
  }
}
