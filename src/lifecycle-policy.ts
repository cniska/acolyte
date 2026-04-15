import {
  CONTEXT_MAX_TOKENS,
  INITIAL_MAX_STEPS,
  MAX_UNKNOWN_ERRORS_PER_REQUEST,
  STEP_TIMEOUT_MS,
  TOOL_TIMEOUT_MS,
  TOTAL_MAX_STEPS,
} from "./lifecycle-constants";
import type { WorkspaceCommand } from "./workspace-profile";

export type LifecyclePolicy = {
  // Step limits
  totalMaxSteps: number;
  initialMaxSteps: number;
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
  totalMaxSteps: TOTAL_MAX_STEPS,
  initialMaxSteps: INITIAL_MAX_STEPS,
  stepTimeoutMs: STEP_TIMEOUT_MS,
  maxUnknownErrorsPerRequest: MAX_UNKNOWN_ERRORS_PER_REQUEST,
  toolTimeoutMs: TOOL_TIMEOUT_MS,
  contextMaxTokens: CONTEXT_MAX_TOKENS,
};

export function createLifecyclePolicy(override?: Partial<LifecyclePolicy>): LifecyclePolicy {
  if (!override) return defaultLifecyclePolicy;
  return { ...defaultLifecyclePolicy, ...override };
}
