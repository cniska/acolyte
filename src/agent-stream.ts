import type {
  LanguageModelV4,
  LanguageModelV4FinishReason,
  LanguageModelV4Message,
  LanguageModelV4ReasoningPart,
  LanguageModelV4StreamPart,
  LanguageModelV4TextPart,
  LanguageModelV4ToolCallPart,
  LanguageModelV4ToolResultPart,
  SharedV4ProviderOptions,
} from "@ai-sdk/provider";
import type { Agent, GenerateResult, StreamChunk, StreamOptions, StreamOutput, ToolCallEntry } from "./agent-contract";
import { ERROR_KINDS, LIFECYCLE_ERROR_CODES } from "./error-contract";
import { serializeToolError } from "./error-handling";
import { MAX_TOOL_RESULT_CHARS } from "./lifecycle-constants";
import { log } from "./log";
import { createModel } from "./model-factory";
import { applyPromptCacheMarkers } from "./prompt-cache";
import { estimatePromptSize, promptBudgetError } from "./prompt-size";
import { normalizeModel, providerFromModel } from "./provider-config";
import { type RateLimiter, sharedRateLimiter } from "./rate-limiter";
import { type ToolDefinition, toFunctionTools } from "./tool-contract";
import { truncateMiddle } from "./truncate-text";

async function resolveInstructions(instructions: Agent["instructions"]): Promise<string> {
  if (typeof instructions === "string") return instructions;
  return instructions();
}

export function createAgentStream(
  model: LanguageModelV4,
  instructions: Agent["instructions"],
  tools: Record<string, ToolDefinition>,
  rateLimiter: RateLimiter,
  provider = providerFromModel(model.modelId),
): Agent["stream"] {
  const toolsByName = new Map<string, ToolDefinition>();
  for (const tool of Object.values(tools)) {
    toolsByName.set(tool.id, tool);
  }

  return async (prompt: string, options: StreamOptions): Promise<StreamOutput> => {
    const systemPrompt = await resolveInstructions(instructions);
    const functionTools = toFunctionTools(tools);
    const messages: LanguageModelV4Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: [{ type: "text", text: prompt }] },
    ];
    applyPromptCacheMarkers(provider, messages, functionTools);

    // No "commit on stop" rule, so a nudge/rejection continue can never lose the answer.
    let answerText = "";
    // Segments carried across `length` (truncation) reopens: the answer was cut off mid-output,
    // so each continuation appends rather than replaces. Never reset — an earlier truncated
    // segment stays part of the answer even if a later reopen is for a different reason.
    let truncatedPrefix = "";
    const allToolCalls: ToolCallEntry[] = [];
    let loopIteration = 0;
    let streamController!: ReadableStreamDefaultController<StreamChunk>;
    const fullStream = new ReadableStream<StreamChunk>({
      start(controller) {
        streamController = controller;
      },
    });
    options.installSideEffectSink?.((chunk) => streamController.enqueue(chunk));

    const resultPromise = (async (): Promise<GenerateResult> => {
      let finishReason: LanguageModelV4FinishReason | undefined;
      try {
        while (true) {
          loopIteration++;
          if (loopIteration > 1) streamController.enqueue({ type: "step-start" });
          log.debug("agent-stream.loop.start", { iteration: loopIteration, pending_messages: messages.length });

          const preCallLimit = options.preCallInputTokenLimit;
          if (typeof preCallLimit === "number" && preCallLimit > 0) {
            const size = estimatePromptSize(messages, functionTools);
            const message = promptBudgetError(size, preCallLimit);
            if (message) {
              log.debug("agent-stream.precall.overflow", {
                iteration: loopIteration,
                limit: preCallLimit,
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
              toolChoice: functionTools.length > 0 ? { type: "auto" } : undefined,
              ...(options.reasoning ? { reasoning: options.reasoning } : {}),
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
          const reasoningBlocks = new Map<string, ReasoningBlock>();

          const reader = streamResult.stream.getReader();
          while (true) {
            const { done, value: part } = await reader.read();
            if (done) break;
            emitStreamPart(part, streamController, stepTextParts, pendingToolCalls, reasoningBlocks);
            if (part.type === "finish") {
              finishReason = part.finishReason;
              streamController.enqueue({
                type: "model-usage",
                payload: {
                  inputTokens: part.usage?.inputTokens?.total,
                  outputTokens: part.usage?.outputTokens?.total,
                  cacheReadTokens: part.usage?.inputTokens?.cacheRead,
                  cacheWriteTokens: part.usage?.inputTokens?.cacheWrite,
                  reasoningTokens: part.usage?.outputTokens?.reasoning,
                },
              });
            }
          }

          const stepText = stepTextParts.join("");
          // Text alongside tool calls is narration, not the final response. Only a pure
          // no-tool-call step carries the answer; prepend any prefix carried from a truncation.
          if (pendingToolCalls.length === 0) answerText = truncatedPrefix + stepText;

          if (pendingToolCalls.length > 0) {
            const assistantContent: Array<
              LanguageModelV4ReasoningPart | LanguageModelV4TextPart | LanguageModelV4ToolCallPart
            > = [
              ...reasoningContentParts(reasoningBlocks),
              ...(stepText.length > 0 ? [{ type: "text" as const, text: stepText }] : []),
              ...pendingToolCalls.map((tc) => ({
                type: "tool-call" as const,
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                input: safeParseJSON(tc.input),
              })),
            ];

            const toolResultParts: LanguageModelV4ToolResultPart[] = [];
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

            messages.push({ role: "assistant", content: assistantContent });
            messages.push({ role: "tool", content: toolResultParts });
          }

          // A step is terminal when the model emitted no tool calls (native end_turn) OR it
          // emitted tool calls but finished with a non-tool-calls reason (degenerate; terminate
          // rather than loop).
          const isTerminalStep =
            pendingToolCalls.length === 0 || (finishReason !== undefined && finishReason.unified !== "tool-calls");

          if (isTerminalStep) {
            const extras =
              options.onBeforeFinish?.({ messages, text: stepText, answerText, finishReason: finishReason?.unified }) ??
              [];
            if (extras.length > 0) {
              // On a no-tool-call step the assistant text has not been pushed yet; push it so the
              // reopen nudge has context. On a tool step, assistant+tool messages are already pushed.
              // An empty-answer reopen has blank stepText; skip the empty text block (providers
              // reject it) so the completion backstop can actually retry.
              if (pendingToolCalls.length === 0 && stepText.length > 0) {
                messages.push({ role: "assistant", content: [{ type: "text", text: stepText }] });
              }
              // A truncated no-tool-call step is a fragment of the answer; carry it so the
              // continuation appends to it rather than the assembled answer losing the prefix.
              if (pendingToolCalls.length === 0 && finishReason?.unified === "length") truncatedPrefix += stepText;
              for (const msg of extras) messages.push(msg);
              continue;
            }
            break;
          }

          const extras = options.onBeforeNextCall?.(messages) ?? [];
          for (const msg of extras) messages.push(msg);
        }

        log.debug("agent-stream.complete", {
          iterations: loopIteration,
          total_tool_calls: allToolCalls.length,
          text_length: answerText.length,
          finish_reason: finishReason?.unified ?? "unknown",
        });
        streamController.close();
        return {
          text: answerText,
          textStreamed: answerText.trim().length > 0,
          toolCalls: allToolCalls,
          ...(finishReason ? { finishReason: finishReason.unified } : {}),
        };
      } finally {
        options.installSideEffectSink?.(null);
      }
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

type ReasoningBlock = { text: string; providerOptions?: SharedV4ProviderOptions };

function reasoningContentParts(blocks: Map<string, ReasoningBlock>): LanguageModelV4ReasoningPart[] {
  const parts: LanguageModelV4ReasoningPart[] = [];
  for (const block of blocks.values()) {
    parts.push({
      type: "reasoning",
      text: block.text,
      ...(block.providerOptions ? { providerOptions: block.providerOptions } : {}),
    });
  }
  return parts;
}

function emitStreamPart(
  part: LanguageModelV4StreamPart,
  controller: ReadableStreamDefaultController<StreamChunk>,
  textParts: string[],
  pendingToolCalls: Array<{ toolCallId: string; toolName: string; input: string }>,
  reasoningBlocks: Map<string, ReasoningBlock>,
): void {
  switch (part.type) {
    case "text-delta": {
      if (part.delta.length > 0) {
        textParts.push(part.delta);
        controller.enqueue({ type: "text-delta", payload: { text: part.delta } });
      }
      break;
    }
    case "reasoning-start": {
      const block = reasoningBlocks.get(part.id) ?? { text: "" };
      if (part.providerMetadata) block.providerOptions = { ...block.providerOptions, ...part.providerMetadata };
      reasoningBlocks.set(part.id, block);
      break;
    }
    case "reasoning-delta": {
      const block = reasoningBlocks.get(part.id) ?? { text: "" };
      block.text += part.delta;
      if (part.providerMetadata) block.providerOptions = { ...block.providerOptions, ...part.providerMetadata };
      reasoningBlocks.set(part.id, block);
      controller.enqueue({ type: "reasoning-delta", payload: { text: part.delta } });
      break;
    }
    case "reasoning-end": {
      const block = reasoningBlocks.get(part.id) ?? { text: "" };
      if (part.providerMetadata) block.providerOptions = { ...block.providerOptions, ...part.providerMetadata };
      reasoningBlocks.set(part.id, block);
      break;
    }
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
  const stream = createAgentStream(modelInstance, input.instructions, tools, rateLimiter, provider);
  return {
    id: input.id ?? "agent",
    name: input.name ?? "Agent",
    instructions: input.instructions,
    model: modelInstance,
    tools,
    stream,
  };
}
