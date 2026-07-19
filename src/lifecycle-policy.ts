import {
  MAX_CONTEXT_INPUT_TOKENS,
  MAX_TOOL_CALLS_PER_REQUEST,
  MAX_UNKNOWN_ERRORS_PER_REQUEST,
  STEP_TIMEOUT_MS,
  TOOL_TIMEOUT_MS,
} from "./lifecycle-constants";
import type { WorkspaceCommand } from "./workspace-contract";

export type LifecyclePolicy = {
  // Step limits
  maxToolCallsPerRequest: number;
  maxUnknownErrorsPerRequest: number;
  // Timeouts
  stepTimeoutMs: number;
  toolTimeoutMs: number;
  // Input budgets
  contextMaxTokens: number;
  // Workspace commands
  installCommand?: WorkspaceCommand;
  formatCommand?: WorkspaceCommand;
  lintCommand?: WorkspaceCommand;
};

export const defaultLifecyclePolicy: LifecyclePolicy = {
  maxToolCallsPerRequest: MAX_TOOL_CALLS_PER_REQUEST,
  stepTimeoutMs: STEP_TIMEOUT_MS,
  maxUnknownErrorsPerRequest: MAX_UNKNOWN_ERRORS_PER_REQUEST,
  toolTimeoutMs: TOOL_TIMEOUT_MS,
  contextMaxTokens: MAX_CONTEXT_INPUT_TOKENS,
};

export function createLifecyclePolicy(override?: Partial<LifecyclePolicy>): LifecyclePolicy {
  if (!override) return defaultLifecyclePolicy;
  return { ...defaultLifecyclePolicy, ...override };
}
