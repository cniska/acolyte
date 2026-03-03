import type { ChatRequest, ChatResponse } from "./api";
import type { StreamEvent } from "./client";
import { runLifecycle } from "./lifecycle";
import type { LifecycleDebugEvent } from "./lifecycle-events";

export { createAgentInput, createSubagentContext, estimateTokens } from "./agent-input";
export { createInstructions, createModeInstructions } from "./agent-instructions";
export { resolveModelProviderState, resolveRunnableModel, type ModelCredentials } from "./agent-model";
export {
  canonicalToolId,
  finalizeAssistantOutput,
  finalizeReviewOutput,
  formatToolHeader,
  isPlanLikeOutput,
} from "./agent-output";

export type RunAgentInput = {
  request: ChatRequest;
  soulPrompt: string;
  workspace?: string;
  taskId?: string;
  onEvent?: (event: StreamEvent) => void;
  onDebug?: (event: LifecycleDebugEvent) => void;
  shouldYield?: () => boolean;
};

export async function runAgent(input: RunAgentInput): Promise<ChatResponse> {
  return runLifecycle(input);
}
