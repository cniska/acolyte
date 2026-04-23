import type {
  LanguageModelV3,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3Message,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolResultPart,
} from "@ai-sdk/provider";
import type { Agent, StreamOptions, StreamOutput } from "./agent-contract";
import { ERROR_KINDS, LIFECYCLE_ERROR_CODES } from "./error-contract";
import { serializeToolError } from "./error-handling";
import { MAX_TOOL_RESULT_CHARS } from "./lifecycle-constants";
import type { GenerateResult, LifecycleSignal, StreamChunk, ToolCallEntry } from "./lifecycle-contract";
import {
  appendLifecycleTextDelta,
  createLifecycleTextStreamState,
  finalizeLifecycleText,
  type LifecycleTextStreamState,
} from "./lifecycle-signal";
import { log } from "./log";
import { createModel } from "./model-factory";
import { estimatePromptSize, promptBudgetError } from "./prompt-size";
import { normalizeModel, providerFromModel } from "./provider-config";
import { type RateLimiter, sharedRateLimiter } from "./rate-limiter";
import type { ToolDefinition } from "./tool-contract";
import { truncateMiddle } from "./truncate-text";

function toolsToFunctionTools(tools: Record<string, ToolDefinition>): LanguageModelV3FunctionTool[] {
  return Object.values(tools).map((tool) => ({
    type: "function" as const,
    name: tool.id,
    description: tool.description,
    inputSchema: tool.inputSchema as LanguageModelV3FunctionTool["inputSchema"],
  }));
}

async function resolveInstructions(instructions: Agent["instructions"]): Promise<string> {
  if (typeof instructions === "string") return instructions;
  return instructions();
}

export function createAgentStream(
  model: LanguageModelV3,
  instructions: Agent["instructions"],
  tools: Record<string, ToolDefinition>,
  rateLimiter: RateLimiter,
): Agent["stream"] {
  const toolsByName = new Map<string, ToolDefinition>();
  for (const tool of Object.values(tools)) {
    toolsByName.set(tool.id, tool);
  }

  return async (prompt: string, options: StreamOptions): Promise<StreamOutput> => {
    const systemPrompt = await resolveInstructions(instructions);
    const functionTools = toolsToFunctionTools(tools);
    const messages: LanguageModelV3Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: [{ type: "text", text: prompt }] },
    ];

    let fullText = "";
    const allToolCalls: ToolCallEntry[] = [];
    let loopIteration = 0;
    let streamController!: ReadableStreamDefaultController<StreamChunk>;
    const fullStream = new ReadableStream<StreamChunk>({
      start(controller) {
        streamController = controller;
      },
    });

    const resultPromise = (async (): Promise<GenerateResult> => {
      let lifecycleSignal: LifecycleSignal | undefined;
      let finishReason: LanguageModelV3FinishReason | undefined;
      while (true) {
        loopIteration++;
        if (loopIteration > 1) streamController.enqueue({ type: "step-start" });
        log.debug("agent-stream.loop.start", { iteration: loopIteration, pending_messages: messages.length });

        if (typeof options.preCallInputTokenLimit === "number") {
          const size = estimatePromptSize(messages, functionTools);
          const message = promptBudgetError(size, options.preCallInputTokenLimit);
          if (message) {
            log.debug("agent-stream.precall.overflow", {
              iteration: loopIteration,
              limit: options.preCallInputTokenLimit,
              total: size.total,
              system: size.system,
              tools: size.tools,
              messages: size.messages,
              message_count: messages.length,
            });
            const err = new Error(message) as Error & { code: string; kind: string };
            err.code = LIFECYCLE_ERROR_CODES.budgetExhausted;
            err.kind = ERROR_KINDS.budgetExhausted;
            throw err;
          }
        }

        await rateLimiter.beforeCall();
        let streamResult: Awaited<ReturnType<typeof model.doStream>>;
        try {
          streamResult = await model.doStream({
            prompt: messages,
            temperature: options.temperature,
            tools: functionTools.length > 0 ? functionTools : undefined,
            toolChoice: options.toolChoice
              ? { type: options.toolChoice }
              : functionTools.length > 0
                ? { type: "auto" }
                : undefined,
            ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
          });
          rateLimiter.reset();
        } catch (error) {
          const recovery = rateLimiter.onError(error);
          if (recovery.shouldRetry) {
            log.debug("agent-stream.rate_limit.retry", { delay_ms: recovery.delayMs, iteration: loopIteration });
            await new Promise((resolve) => setTimeout(resolve, recovery.delayMs));
            continue;
          }
          throw error;
        }

        const pendingToolCalls: Array<{
          toolCallId: string;
          toolName: string;
          input: string;
        }> = [];
        finishReason = undefined;
        const stepTextParts: string[] = [];
        const lifecycleTextState = createLifecycleTextStreamState();

        const reader = streamResult.stream.getReader();
        while (true) {
          const { done, value: part } = await reader.read();
          if (done) break;
          emitStreamPart(part, streamController, stepTextParts, pendingToolCalls, lifecycleTextState);
          if (part.type === "finish") {
            finishReason = part.finishReason;
            streamController.enqueue({
              type: "model-usage",
              payload: {
                inputTokens: part.usage?.inputTokens?.total,
                outputTokens: part.usage?.outputTokens?.total,
              },
            });
          }
        }

        const finalizedStep = finalizeLifecycleText(lifecycleTextState);
        if (finalizedStep.signal) lifecycleSignal = finalizedStep.signal;
        if (finalizedStep.text.length > 0) {
          stepTextParts.push(finalizedStep.text);
          streamController.enqueue({ type: "text-delta", payload: { text: finalizedStep.text } });
        }

        const stepText = stepTextParts.join("");
        if (stepText.length > 0) fullText += stepText;

        if (pendingToolCalls.length === 0) break;

        const assistantContent: LanguageModelV3ToolCallPart[] = pendingToolCalls.map((tc) => ({
          type: "tool-call" as const,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: safeParseJSON(tc.input),
        }));

        const toolResultParts: LanguageModelV3ToolResultPart[] = [];
        for (const tc of pendingToolCalls) {
          allToolCalls.push({ toolCallId: tc.toolCallId, toolName: tc.toolName, args: tc.input });
          const tool = toolsByName.get(tc.toolName);
          if (!tool) {
            const error = `Unknown tool: ${tc.toolName}`;
            streamController.enqueue({
              type: "tool-error",
              payload: { error, message: error, toolName: tc.toolName, toolCallId: tc.toolCallId },
            });
            toolResultParts.push({
              type: "tool-result",
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              output: { type: "text", value: JSON.stringify({ error }) },
            });
            continue;
          }

          try {
            const args = JSON.parse(tc.input);
            const { result, effectOutput } = await tool.execute(args, tc.toolCallId);
            streamController.enqueue({
              type: "tool-result",
              payload: { toolCallId: tc.toolCallId, toolName: tc.toolName, result },
            });
            const raw = effectOutput ? `${JSON.stringify(result)}\n${effectOutput}` : JSON.stringify(result);
            const outputValue = truncateMiddle(raw, MAX_TOOL_RESULT_CHARS);
            toolResultParts.push({
              type: "tool-result",
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              output: { type: "text", value: outputValue },
            });
          } catch (error) {
            const serializedError = serializeToolError(error);
            const message = serializedError.error.message;
            const code = serializedError.error.code;
            const kind = serializedError.error.kind;
            streamController.enqueue({
              type: "tool-error",
              payload: {
                error: serializedError.error,
                message,
                code,
                kind,
                toolName: tc.toolName,
                toolCallId: tc.toolCallId,
              },
            });
            toolResultParts.push({
              type: "tool-result",
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              output: { type: "text", value: JSON.stringify(serializedError) },
            });
          }
        }

        compactPriorToolResults(messages);
        messages.push({ role: "assistant", content: assistantContent });
        messages.push({ role: "tool", content: toolResultParts });

        if (finishReason?.unified !== "tool-calls" && finishReason !== undefined) break;
      }

      log.debug("agent-stream.complete", {
        iterations: loopIteration,
        total_tool_calls: allToolCalls.length,
        text_length: fullText.length,
        finish_reason: finishReason?.unified ?? "unknown",
        signal: lifecycleSignal ?? null,
      });
      streamController.close();
      return { text: fullText, toolCalls: allToolCalls, ...(lifecycleSignal ? { signal: lifecycleSignal } : {}) };
    })().catch((error) => {
      try {
        streamController.error(error);
      } catch {
        /* stream already closed */
      }
      throw error;
    });

    return { fullStream, getFullOutput: () => resultPromise };
  };
}

function emitStreamPart(
  part: LanguageModelV3StreamPart,
  controller: ReadableStreamDefaultController<StreamChunk>,
  textParts: string[],
  pendingToolCalls: Array<{ toolCallId: string; toolName: string; input: string }>,
  lifecycleTextState: LifecycleTextStreamState,
): void {
  switch (part.type) {
    case "text-delta": {
      const visibleText = appendLifecycleTextDelta(lifecycleTextState, part.delta);
      if (visibleText.length > 0) {
        textParts.push(visibleText);
        controller.enqueue({ type: "text-delta", payload: { text: visibleText } });
      }
      break;
    }
    case "reasoning-delta":
      controller.enqueue({ type: "reasoning-delta", payload: { text: part.delta } });
      break;
    case "tool-call":
      pendingToolCalls.push({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      });
      controller.enqueue({
        type: "tool-call",
        payload: {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args: safeParseJSON(part.input),
        },
      });
      break;
    case "error": {
      const message = part.error instanceof Error ? part.error.message : String(part.error);
      controller.enqueue({
        type: "tool-error",
        payload: { error: part.error, message },
      });
      break;
    }
  }
}

export const COMPACTED_OUTPUT = { type: "text" as const, value: "[previous tool result]" };

const PRESERVE_TOOL_RESULTS = new Set<string>(["file-read"]);

export function compactPriorToolResults(messages: LanguageModelV3Message[]): void {
  for (const message of messages) {
    if (message.role !== "tool") continue;
    for (let i = 0; i < message.content.length; i++) {
      const part = message.content[i];
      if (part.type !== "tool-result") continue;
      if (PRESERVE_TOOL_RESULTS.has(part.toolName)) continue;
      message.content[i] = { ...part, output: COMPACTED_OUTPUT };
    }
  }
}

function safeParseJSON(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
    return {};
  }
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function createAgent(input: {
  model: string;
  instructions: Agent["instructions"];
  id?: string;
  name?: string;
  tools?: Record<string, ToolDefinition>;
}): Agent {
  const qualifiedModel = normalizeModel(input.model);
  const provider = providerFromModel(qualifiedModel);
  const rateLimiter = sharedRateLimiter(provider);
  const modelInstance = createModel(qualifiedModel, rateLimiter);
  const tools = input.tools ?? {};
  const stream = createAgentStream(modelInstance, input.instructions, tools, rateLimiter);
  return {
    id: input.id ?? "agent",
    name: input.name ?? "Agent",
    instructions: input.instructions,
    model: modelInstance,
    tools,
    stream,
  };
}
