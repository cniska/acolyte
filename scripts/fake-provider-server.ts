export type FakeProviderServer = {
  baseUrl: string;
  stop: () => void;
};

const debugEnabled = process.env.ACOLYTE_FAKE_PROVIDER_DEBUG === "1";

export type ResponseRequest = {
  model?: string;
  input?: unknown;
  previous_response_id?: string;
  stream?: boolean;
  tools?: Array<{ type?: string; name?: string }>;
};

export type FunctionCallOutput = { callId: string };

export type ToolCallPayload = {
  id: string;
  callId: string;
  name: string;
  args: string;
};

export type FakeProviderRequestContext = {
  body: ResponseRequest;
  model: string;
  responseCounter: number;
  sourceText: string;
  outputs: FunctionCallOutput[];
  previousResponseId: string;
};

export type FakeProviderHandler = (ctx: FakeProviderRequestContext) => Record<string, unknown>;

export type FakeProviderServerOptions = {
  handleRequest?: FakeProviderHandler;
  /** Delay in ms before each response. Useful for tests that need to observe in-flight state. */
  responseDelayMs?: number;
};

export type MarkerScenario<Id extends string> = {
  id: Id;
  marker: string;
  handle: (ctx: FakeProviderRequestContext) => Record<string, unknown>;
};

function s(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function fakeResponseId(counter: number): string {
  return `resp_${counter.toString().padStart(5, "0")}`;
}

export function extractSourceText(input: unknown): string {
  return JSON.stringify(input ?? "").toLowerCase();
}

export function extractFunctionCallOutputs(input: unknown): FunctionCallOutput[] {
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

export function pickFunctionToolName(
  tools: ResponseRequest["tools"],
  preferred: string,
  fuzzyTokens: readonly string[],
): string {
  if (!Array.isArray(tools)) return preferred;
  const names = tools
    .filter((tool) => tool && typeof tool === "object" && s(tool.type) === "function")
    .map((tool) => s(tool?.name).trim())
    .filter((name) => name.length > 0);
  const exact = names.find((name) => name === preferred);
  if (exact) return exact;
  return names.find((name) => fuzzyTokens.some((token) => name.includes(token))) ?? preferred;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function usage(outputTokens: number, totalTokens: number): Record<string, unknown> {
  return {
    input_tokens: 1,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: outputTokens,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: totalTokens,
  };
}

function responseBase(
  model: string,
  idCounter: number,
  outputText: string,
  output: Array<Record<string, unknown>>,
  outputTokens: number,
  totalTokens: number,
): Record<string, unknown> {
  return {
    id: fakeResponseId(idCounter),
    object: "response",
    created_at: nowSeconds(),
    status: "completed",
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: {},
    model,
    output_text: outputText,
    output,
    usage: usage(outputTokens, totalTokens),
    parallel_tool_calls: true,
    temperature: 1,
    tool_choice: "auto",
    tools: [],
    top_p: 1,
  };
}

export function createMessagePayload(model: string, idCounter: number, text: string): Record<string, unknown> {
  const outTokens = Math.max(1, Math.ceil(text.length / 4));
  return responseBase(
    model,
    idCounter,
    text,
    [
      {
        id: `msg_${idCounter}`,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    outTokens,
    outTokens + 1,
  );
}

export function createToolCallsPayload(
  model: string,
  idCounter: number,
  calls: ToolCallPayload[],
): Record<string, unknown> {
  return responseBase(
    model,
    idCounter,
    "",
    calls.map((call) => ({
      type: "function_call",
      id: call.id,
      call_id: call.callId,
      name: call.name,
      arguments: call.args,
      status: "completed",
    })),
    calls.length,
    calls.length + 1,
  );
}

export function createMarkerScenarioHandler<Id extends string>(
  scenarios: readonly MarkerScenario<Id>[],
  defaultText = "ok",
): FakeProviderHandler {
  const scenarioByResponseId = new Map<string, MarkerScenario<Id>>();

  return (ctx: FakeProviderRequestContext): Record<string, unknown> => {
    const scenario =
      (ctx.previousResponseId ? scenarioByResponseId.get(ctx.previousResponseId) : undefined) ??
      scenarios.find((entry) => ctx.sourceText.includes(entry.marker));
    if (!scenario) return createMessagePayload(ctx.model, ctx.responseCounter, defaultText);
    scenarioByResponseId.set(fakeResponseId(ctx.responseCounter), scenario);
    return scenario.handle(ctx);
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

function toSse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function streamFromPayload(payload: Record<string, unknown>): string {
  const id = s(payload.id);
  const createdAt = typeof payload.created_at === "number" ? payload.created_at : nowSeconds();
  const model = s(payload.model) || "gpt-5-mini";
  const usageValue = (payload.usage as Record<string, unknown> | undefined) ?? usage(1, 2);
  const output = Array.isArray(payload.output) ? (payload.output as Array<Record<string, unknown>>) : [];

  const chunks: unknown[] = [
    { type: "response.created", response: { id, created_at: createdAt, model, service_tier: null } },
  ];

  for (let i = 0; i < output.length; i += 1) {
    const item = output[i];
    const type = s(item.type);

    if (type === "function_call") {
      const itemId = s(item.id);
      const callId = s(item.call_id);
      const name = s(item.name);
      const args = s(item.arguments);
      chunks.push({
        type: "response.output_item.added",
        output_index: i,
        item: { type: "function_call", id: itemId, call_id: callId, name, arguments: args },
      });
      chunks.push({ type: "response.function_call_arguments.delta", item_id: itemId, output_index: i, delta: args });
      chunks.push({
        type: "response.output_item.done",
        output_index: i,
        item: { type: "function_call", id: itemId, call_id: callId, name, arguments: args, status: "completed" },
      });
      continue;
    }

    if (type === "message") {
      const itemId = s(item.id);
      const content = Array.isArray(item.content) ? (item.content as Array<Record<string, unknown>>) : [];
      const text = s(content.find((part) => s(part.type) === "output_text")?.text);
      chunks.push({ type: "response.output_item.added", output_index: i, item: { type: "message", id: itemId } });
      if (text.length > 0) {
        chunks.push({ type: "response.output_text.delta", item_id: itemId, delta: text, logprobs: null });
      }
      chunks.push({ type: "response.output_item.done", output_index: i, item: { type: "message", id: itemId } });
    }
  }

  chunks.push({
    type: "response.completed",
    response: { incomplete_details: null, usage: usageValue, service_tier: null },
  });

  return `${chunks.map((chunk) => toSse(chunk)).join("")}data: [DONE]\n\n`;
}

function defaultHandler(ctx: FakeProviderRequestContext): Record<string, unknown> {
  return createMessagePayload(ctx.model, ctx.responseCounter, "ok");
}

export function startFakeProviderServer(options: FakeProviderServerOptions = {}): FakeProviderServer {
  const handleRequest = options.handleRequest ?? defaultHandler;
  const responseDelayMs = options.responseDelayMs ?? 0;
  let responseCounter = 0;
  const notFound = () =>
    new Response(JSON.stringify({ error: { message: "Not found" } }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/v1/responses" || req.method !== "POST") {
        return notFound();
      }

      const bodyText = await req.text();
      const body = parseResponsesRequest(bodyText);
      const model = s(body.model).trim() || "gpt-5-mini";
      const sourceText = extractSourceText(body.input);
      const outputs = extractFunctionCallOutputs(body.input);
      const previousResponseId = s(body.previous_response_id).trim();

      responseCounter += 1;
      const ctx: FakeProviderRequestContext = {
        body,
        model,
        responseCounter,
        sourceText,
        outputs,
        previousResponseId,
      };
      const payload = handleRequest(ctx);

      if (responseDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, responseDelayMs));
      }

      if (debugEnabled) {
        const sourcePreview = sourceText.slice(0, 180).replace(/\s+/g, " ");
        console.error(
          `[fake-provider] req=${responseCounter} prev=${previousResponseId || "-"} outputs=${outputs.length} source=${sourcePreview}`,
        );
      }

      if (body.stream === true) {
        return new Response(streamFromPayload(payload), {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      }

      return Response.json(payload);
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    stop: () => server.stop(true),
  };
}

export async function withFakeProviderServer<T>(
  fn: (baseUrl: string) => Promise<T>,
  options?: FakeProviderServerOptions,
): Promise<T> {
  const fake = startFakeProviderServer(options);
  try {
    return await fn(fake.baseUrl);
  } finally {
    fake.stop();
  }
}
