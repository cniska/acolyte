import { z } from "zod";
import { type LifecycleSignal, lifecycleSignalSchema } from "./lifecycle-contract";
import { createTool, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";

export const lifecycleSignalToolNameSchema = z.enum(["signal_done", "signal_no_op", "signal_blocked"]);
export type LifecycleSignalToolName = z.infer<typeof lifecycleSignalToolNameSchema>;

const signalToolToSignal: Record<LifecycleSignalToolName, LifecycleSignal> = {
  signal_done: "done",
  signal_no_op: "no_op",
  signal_blocked: "blocked",
};

const signalOutputSchema = z.object({
  kind: z.literal("lifecycle-signal"),
  signal: lifecycleSignalSchema,
  reason: z.string().min(1).optional(),
});

export type SignalToolOutput = z.infer<typeof signalOutputSchema>;

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
    outputSchema: signalOutputSchema,
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
        { skipBudget: true },
      );
    },
  });
}

function createNoOpSignalTool(input: ToolkitInput) {
  return createTool({
    id: "signal_no_op",
    toolkit: "signal",
    category: "meta",
    description: "Finish the task when no changes or actions were needed.",
    instruction: "Call `signal_no_op` exactly once when no changes or actions were needed.",
    inputSchema: z.object({}).strict(),
    outputSchema: signalOutputSchema,
    execute: async (toolInput, toolCallId) => {
      return runTool(
        input.session,
        "signal_no_op",
        toolCallId,
        toolInput,
        async () => ({
          kind: "lifecycle-signal" as const,
          signal: "no_op" as const,
        }),
        { skipBudget: true },
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
    outputSchema: signalOutputSchema,
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
        { skipBudget: true },
      );
    },
  });
}

export function createSignalToolkit(input: ToolkitInput) {
  return {
    signalDone: createDoneSignalTool(input),
    signalNoOp: createNoOpSignalTool(input),
    signalBlocked: createBlockedSignalTool(input),
  };
}
