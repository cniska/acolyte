import type { ChatRequest, ChatResponse } from "./api";
import type { StreamEvent } from "./client";
import { runLifecycle } from "./lifecycle";
import type { LifecycleDebugEvent } from "./lifecycle-events";

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
