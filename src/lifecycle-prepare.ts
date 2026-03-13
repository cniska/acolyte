import { createAgentInput, estimateTokens } from "./agent-input";
import { guardStatsFromSession, type PhasePrepareInput, type PhasePrepareResult } from "./lifecycle-contract";
import { toolsForAgent } from "./tool-registry";

/** Approximate overhead for BASE_INSTRUCTIONS + mode-specific instructions. */
const INSTRUCTION_OVERHEAD_TOKENS = 300;

export function phasePrepare(input: PhasePrepareInput): PhasePrepareResult {
  // System prompt tokens are calculated here and passed into createAgentInput
  // so it can reserve context-window space. This is the only place they are
  // counted — createAgentInput's returned promptTokens intentionally excludes them.
  const systemPromptTokens = estimateTokens(input.soulPrompt) + INSTRUCTION_OVERHEAD_TOKENS;
  const requestInput = createAgentInput(input.request, { systemPromptTokens });
  const baseAgentInput = requestInput.input;

  const { tools, session } = toolsForAgent({
    workspace: input.workspace,
    onOutput: input.onOutput,
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
      feedback_summary: event.feedback?.summary ?? null,
    });
  };
  session.toolTimeoutMs = input.policy.toolTimeoutMs;
  session.flags.consecutiveGuardBlockLimit = input.policy.consecutiveGuardBlockLimit;

  input.debug("lifecycle.prepare", {
    task_id: input.taskId ?? null,
    model: input.model,
    mode: input.initialMode,
    history_messages: input.request.history.length,
  });

  if (requestInput.usage.activeSkillName) {
    input.debug("lifecycle.skill.context", {
      skill_name: requestInput.usage.activeSkillName,
      instruction_chars: requestInput.usage.skillInstructionChars ?? 0,
    });
  }

  return { session, tools, baseAgentInput, promptUsage: requestInput.usage };
}
