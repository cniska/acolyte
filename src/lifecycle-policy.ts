import {
  CONTEXT_MAX_TOKENS,
  MAX_CONSECUTIVE_TOOL_FAILURES,
  MAX_TOTAL_TOKENS,
  MAX_UNKNOWN_ERRORS_PER_REQUEST,
  STEP_TIMEOUT_MS,
  TOOL_TIMEOUT_MS,
  TOTAL_MAX_STEPS,
  TURN_MAX_STEPS,
} from "./lifecycle-constants";
import type { WorkspaceCommand } from "./workspace-profile";

export type LifecyclePolicy = {
  // Step limits
  totalMaxSteps: number;
  turnMaxSteps: number;
  maxUnknownErrorsPerRequest: number;
  // Timeouts
  stepTimeoutMs: number;
  toolTimeoutMs: number;
  // Input budgets
  contextMaxTokens: number;
  maxTotalTokens: number;
  maxConsecutiveToolFailures: number;
  // Workspace commands
  installCommand?: WorkspaceCommand;
  formatCommand?: WorkspaceCommand;
  lintCommand?: WorkspaceCommand;
};

export const defaultLifecyclePolicy: LifecyclePolicy = {
  totalMaxSteps: TOTAL_MAX_STEPS,
  turnMaxSteps: TURN_MAX_STEPS,
  stepTimeoutMs: STEP_TIMEOUT_MS,
  maxUnknownErrorsPerRequest: MAX_UNKNOWN_ERRORS_PER_REQUEST,
  toolTimeoutMs: TOOL_TIMEOUT_MS,
  contextMaxTokens: CONTEXT_MAX_TOKENS,
  maxTotalTokens: MAX_TOTAL_TOKENS,
  maxConsecutiveToolFailures: MAX_CONSECUTIVE_TOOL_FAILURES,
};

export function createLifecyclePolicy(override?: Partial<LifecyclePolicy>): LifecyclePolicy {
  if (!override) return defaultLifecyclePolicy;
  return { ...defaultLifecyclePolicy, ...override };
}
