import { createAgentInput, estimateTokens } from "./agent-input";
import type { PhasePrepareInput, PhasePrepareResult } from "./lifecycle-contract";
import { toolsForAgent } from "./tool-registry";

/** Approximate overhead for BASE_INSTRUCTIONS + runtime instructions. */
const INSTRUCTION_OVERHEAD_TOKENS = 300;

function estimateToolTokens(tools: ReturnType<typeof toolsForAgent>["tools"]): number {
  return Object.values(tools).reduce(
    (sum, tool) => sum + estimateTokens([tool.id, tool.description, tool.instruction].join("\n")),
    0,
  );
}

export function phasePrepare(input: PhasePrepareInput): PhasePrepareResult {
  // System prompt tokens are calculated here and passed into createAgentInput
  // so it can reserve context-window space. This is the only place they are
  // counted — createAgentInput's returned inputTokens intentionally excludes them.
  const systemPromptTokens = estimateTokens(input.soulPrompt) + INSTRUCTION_OVERHEAD_TOKENS;
  const { tools, session } = toolsForAgent({
    workspace: input.workspace,
    onOutput: input.onOutput,
    onChecklist: input.onChecklist,
    taskId: input.taskId,
    sessionId: input.request.sessionId,
    mcpListings: input.mcpListings,
  });
  const toolTokens = estimateToolTokens(tools);
  const { policy } = input;
  const requestInput = createAgentInput(input.request, {
    systemPromptTokens,
    toolTokens,
    contextMaxTokens: policy.contextMaxTokens,
    budget: {
      maxHistoryMessages: policy.maxHistoryMessages,
      maxMessageTokens: policy.maxMessageTokens,
      maxAttachmentMessageTokens: policy.maxAttachmentMessageTokens,
      maxSkillContextTokens: policy.maxSkillContextTokens,
    },
  });
  requestInput.usage.toolTokens = toolTokens;
  requestInput.usage.messageTokens = requestInput.usage.inputTokens;
  const baseAgentInput = requestInput.input;

  session.toolTimeoutMs = input.policy.toolTimeoutMs;

  input.debug("lifecycle.prepare", {
    task_id: input.taskId ?? null,
    model: input.model,
    history_messages: input.request.history.length,
  });

  if (input.request.activeSkills?.length) {
    input.debug("lifecycle.skill.context", {
      skill_names: input.request.activeSkills.map((s) => s.name),
    });
  }

  return { session, tools, baseAgentInput, promptUsage: requestInput.usage };
}
