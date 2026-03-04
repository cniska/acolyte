import { createAgentInput } from "./agent-input";
import { guardStatsFromSession, type PhasePrepareInput, type PhasePrepareResult } from "./lifecycle-contract";
import { toolsForAgent } from "./tool-registry";

export function phasePrepare(input: PhasePrepareInput): PhasePrepareResult {
  const requestInput = createAgentInput(input.request);
  const agentInput = requestInput.input;

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
  });

  return { session, tools, agentInput, promptUsage: requestInput.usage };
}
