import { z } from "zod";
import type { LifecycleSignal } from "./lifecycle-contract";
import { createTool, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";

export const lifecycleSignalToolNameSchema = z.enum(["signal_done", "signal_noop", "signal_blocked"]);
export type LifecycleSignalToolName = z.infer<typeof lifecycleSignalToolNameSchema>;

const signalToolToSignal: Record<LifecycleSignalToolName, LifecycleSignal> = {
  signal_done: "done",
  signal_noop: "noop",
  signal_blocked: "blocked",
};

export function signalForToolName(toolName: string): LifecycleSignal | undefined {
  const parsed = lifecycleSignalToolNameSchema.safeParse(toolName);
  if (!parsed.success) return undefined;
  return signalToolToSignal[parsed.data];
}

function createDoneSignalTool(input: ToolkitInput) {
  return createTool({
    id: "signal_done",
    toolkit: "signal",
    category: "meta",
    description: "Finish the task when the requested work has been completed.",
    instruction: "Call `signal_done` exactly once when the requested work is complete.",
    inputSchema: z.object({}).strict(),
    outputSchema: z
      .object({
        kind: z.literal("lifecycle-signal"),
        signal: z.literal("done"),
      })
      .strict(),
    execute: async (toolInput, toolCallId) => {
      return runTool(
        input.session,
        "signal_done",
        toolCallId,
        toolInput,
        async () => ({
          kind: "lifecycle-signal" as const,
          signal: "done" as const,
        }),
        { skipStepBudget: true },
      );
    },
  });
}

function createNoopSignalTool(input: ToolkitInput) {
  return createTool({
    id: "signal_noop",
    toolkit: "signal",
    category: "meta",
    description: "Finish the task when no changes or actions were needed.",
    instruction: "Call `signal_noop` exactly once when no changes or actions were needed.",
    inputSchema: z.object({}).strict(),
    outputSchema: z
      .object({
        kind: z.literal("lifecycle-signal"),
        signal: z.literal("noop"),
      })
      .strict(),
    execute: async (toolInput, toolCallId) => {
      return runTool(
        input.session,
        "signal_noop",
        toolCallId,
        toolInput,
        async () => ({
          kind: "lifecycle-signal" as const,
          signal: "noop" as const,
        }),
        { skipStepBudget: true },
      );
    },
  });
}

function createBlockedSignalTool(input: ToolkitInput) {
  return createTool({
    id: "signal_blocked",
    toolkit: "signal",
    category: "meta",
    description:
      "Finish the task as blocked. Requires a reason explaining what is missing and what will happen once it is provided.",
    instruction:
      "Call `signal_blocked` exactly once when blocked, with `reason` explaining what is missing and what you will do once it is provided.",
    inputSchema: z
      .object({
        reason: z.string().min(1),
      })
      .strict(),
    outputSchema: z
      .object({
        kind: z.literal("lifecycle-signal"),
        signal: z.literal("blocked"),
        reason: z.string().min(1),
      })
      .strict(),
    execute: async (toolInput, toolCallId) => {
      return runTool(
        input.session,
        "signal_blocked",
        toolCallId,
        toolInput,
        async () => ({
          kind: "lifecycle-signal" as const,
          signal: "blocked" as const,
          reason: toolInput.reason,
        }),
        { skipStepBudget: true },
      );
    },
  });
}

export function createSignalToolkit(input: ToolkitInput) {
  return {
    signalDone: createDoneSignalTool(input),
    signalNoop: createNoopSignalTool(input),
    signalBlocked: createBlockedSignalTool(input),
  };
}
