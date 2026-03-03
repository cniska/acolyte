import { createAgentInput, createSubagentContext } from "./agent-input";
import { appConfig } from "./app-config";
import { type PhasePrepareInput, type PhasePrepareResult, guardStatsFromSession } from "./lifecycle-contract";
import { toolsForAgent } from "./mastra-tools";

export function phasePrepare(input: PhasePrepareInput): PhasePrepareResult {
  const requestInput = createAgentInput(input.request);
  const subagentContext = createSubagentContext(input.request);
  const agentInput = `${subagentContext}\n\n${requestInput.input}`;

  const resourceId = input.request.resourceId?.trim() || appConfig.memory.resourceId;
  const memoryOptions =
    input.request.useMemory && input.request.sessionId
      ? { thread: input.request.sessionId, resource: resourceId }
      : undefined;

  const { tools, session } = toolsForAgent({
    workspace: input.workspace,
    onToolOutput: input.onToolOutput,
    taskId: input.taskId,
  });

  session.onGuard = (event) => {
    const current = guardStatsFromSession(session);
    if (event.action === "blocked") {
      session.flags.guardStats = { blocked: current.blocked + 1, flagSet: current.flagSet };
    } else if (event.action === "flag_set") {
      session.flags.guardStats = { blocked: current.blocked, flagSet: current.flagSet + 1 };
    }
    input.debug("lifecycle.guard", {
      guard: event.guardId,
      tool: event.toolName,
      action: event.action,
      detail: event.detail,
    });
  };

  input.debug("lifecycle.prepare", {
    task_id: input.taskId ?? null,
    model: input.model,
    mode: input.classifiedMode,
    history_messages: input.request.history.length,
    has_memory: Boolean(memoryOptions),
  });

  return { session, tools, agentInput, memoryOptions, promptUsage: requestInput.usage };
}
