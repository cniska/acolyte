import type { SessionContext } from "./tool-guards";
import type { ToolName } from "./tool-names";

type GuardedExecute = <T>(
  toolId: ToolName,
  args: Record<string, unknown>,
  session: SessionContext,
  task: () => Promise<T>,
) => Promise<T>;

type WithToolError = <T>(toolId: ToolName, task: () => Promise<T>) => Promise<T>;

export type ToolAdapterRuntime = {
  session: SessionContext;
  guardedExecute: GuardedExecute;
  withToolError: WithToolError;
  streamCallId: (toolName: ToolName) => string;
};

export async function runToolAdapter<T>(
  runtime: ToolAdapterRuntime,
  toolId: ToolName,
  args: Record<string, unknown>,
  execute: (toolCallId: string) => Promise<T>,
): Promise<T> {
  return runtime.withToolError(toolId, () =>
    runtime.guardedExecute(toolId, args, runtime.session, () => execute(runtime.streamCallId(toolId))),
  );
}
