import type {
  LanguageModelV3,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3Message,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolResultPart,
} from "@ai-sdk/provider";
import { z } from "zod";
import type { Agent, StreamOptions, StreamOutput } from "./agent-contract";
import type { GenerateResult, StreamChunk, ToolCallEntry } from "./lifecycle-contract";
import { log } from "./log";
import { createModel } from "./model-factory";
import { normalizeModel } from "./provider-config";
import type { ToolDefinition } from "./tool-contract";

function toolInputJsonSchema(schema: z.ZodType): LanguageModelV3FunctionTool["inputSchema"] {
  const { $schema: _, ...rest } = z.toJSONSchema(schema);
  return rest as LanguageModelV3FunctionTool["inputSchema"];
}

function toolsToFunctionTools(tools: Record<string, ToolDefinition>): LanguageModelV3FunctionTool[] {
  return Object.values(tools).map((tool) => ({
    type: "function" as const,
    name: tool.id,
    description: tool.description,
    inputSchema: toolInputJsonSchema(tool.inputSchema),
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
    let nudgeCount = 0;
    const maxNudges = options.maxNudges ?? 0;

    let streamController!: ReadableStreamDefaultController<StreamChunk>;
    const fullStream = new ReadableStream<StreamChunk>({
      start(controller) {
        streamController = controller;
      },
    });

    const resultPromise = (async (): Promise<GenerateResult> => {
      while (true) {
        loopIteration++;
        log.debug("agent-stream.loop.start", { iteration: loopIteration, pending_messages: messages.length });
        const streamResult = await model.doStream({
          prompt: messages,
          temperature: options.temperature,
          tools: functionTools.length > 0 ? functionTools : undefined,
          toolChoice: options.toolChoice
            ? { type: options.toolChoice }
            : functionTools.length > 0
              ? { type: "auto" }
              : undefined,
        });

        const pendingToolCalls: Array<{
          toolCallId: string;
          toolName: string;
          input: string;
        }> = [];
        let finishReason: LanguageModelV3FinishReason | undefined;
        const stepTextParts: string[] = [];

        const reader = streamResult.stream.getReader();
        while (true) {
          const { done, value: part } = await reader.read();
          if (done) break;
          emitStreamPart(part, streamController, stepTextParts, pendingToolCalls);
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

        const stepText = stepTextParts.join("");
        if (stepText.length > 0) fullText += stepText;

        if (pendingToolCalls.length === 0) {
          if (nudgeCount < maxNudges && allToolCalls.length > 0 && stepText.trim().length > 0) {
            nudgeCount++;
            log.debug("agent-stream.nudge", {
              reason: "no_tool_calls",
              nudge_count: nudgeCount,
              max_nudges: maxNudges,
              iteration: loopIteration,
              finish_reason: finishReason?.unified ?? "undefined",
              text_length: stepText.length,
              total_tool_calls: allToolCalls.length,
            });
            messages.push({ role: "assistant", content: [{ type: "text", text: stepText }] });
            messages.push({
              role: "user",
              content: [
                {
                  type: "text",
                  text: "[system] You stopped before completing the task. If you are done, confirm explicitly. Otherwise, continue working with the available tools.",
                },
              ],
            });
            continue;
          }
          log.debug("agent-stream.loop.exit", {
            reason: "no_tool_calls",
            iteration: loopIteration,
            finish_reason: finishReason?.unified ?? "undefined",
            finish_reason_raw: JSON.stringify(finishReason ?? null),
            text_length: stepText.length,
            total_tool_calls: allToolCalls.length,
          });
          break;
        }

        const assistantContent: LanguageModelV3ToolCallPart[] = pendingToolCalls.map((tc) => ({
          type: "tool-call" as const,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: safeParseJSON(tc.input),
        }));

        const toolResultParts: LanguageModelV3ToolResultPart[] = [];
        let batchHadError = false;
        for (const tc of pendingToolCalls) {
          allToolCalls.push({ toolCallId: tc.toolCallId, toolName: tc.toolName, args: tc.input });
          const tool = toolsByName.get(tc.toolName);
          if (!tool) {
            batchHadError = true;
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
            const result = await tool.execute(args);
            streamController.enqueue({
              type: "tool-result",
              payload: { toolCallId: tc.toolCallId, toolName: tc.toolName, result },
            });
            toolResultParts.push({
              type: "tool-result",
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              output: { type: "text", value: JSON.stringify(result) },
            });
          } catch (error) {
            batchHadError = true;
            const message = error instanceof Error ? error.message : String(error);
            const code =
              typeof error === "object" && error !== null && "code" in error
                ? (error as { code?: unknown }).code
                : undefined;
            const kind =
              typeof error === "object" && error !== null && "kind" in error
                ? (error as { kind?: unknown }).kind
                : undefined;
            streamController.enqueue({
              type: "tool-error",
              payload: {
                error: { message, ...(code ? { code } : {}), ...(kind ? { kind } : {}) },
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
              output: { type: "text", value: JSON.stringify({ error: message }) },
            });
          }
        }

        messages.push({ role: "assistant", content: assistantContent });
        messages.push({ role: "tool", content: toolResultParts });

        if (finishReason?.unified !== "tool-calls" && finishReason !== undefined) {
          if (nudgeCount < maxNudges && batchHadError) {
            nudgeCount++;
            log.debug("agent-stream.nudge", {
              reason: "tool_error_early_stop",
              nudge_count: nudgeCount,
              max_nudges: maxNudges,
              iteration: loopIteration,
              finish_reason: finishReason.unified,
              total_tool_calls: allToolCalls.length,
            });
            messages.push({
              role: "user",
              content: [
                {
                  type: "text",
                  text: "[system] One or more tool calls failed. Review the errors above and retry or take a different approach. Do not give up.",
                },
              ],
            });
            continue;
          }
          log.debug("agent-stream.loop.exit", {
            reason: "finish_reason_not_tool_calls",
            iteration: loopIteration,
            finish_reason: finishReason.unified,
            finish_reason_raw: JSON.stringify(finishReason),
            pending_tool_calls: pendingToolCalls.length,
            total_tool_calls: allToolCalls.length,
          });
          break;
        }
      }

      log.debug("agent-stream.complete", {
        iterations: loopIteration,
        total_tool_calls: allToolCalls.length,
        text_length: fullText.length,
      });
      streamController.close();
      return { text: fullText, toolCalls: allToolCalls };
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
): void {
  switch (part.type) {
    case "text-delta":
      textParts.push(part.delta);
      controller.enqueue({ type: "text-delta", payload: { text: part.delta } });
      break;
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
  const modelInstance = createModel(normalizeModel(input.model));
  const tools = input.tools ?? {};
  const stream = createAgentStream(modelInstance, input.instructions, tools);
  return {
    id: input.id ?? "agent",
    name: input.name ?? "Agent",
    instructions: input.instructions,
    model: modelInstance,
    tools,
    stream,
  };
}
