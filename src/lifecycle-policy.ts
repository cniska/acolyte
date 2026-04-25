import {
  BUDGET_NUDGE_THRESHOLDS,
  MAX_CONSECUTIVE_TOOL_FAILURES,
  MAX_CONTEXT_TOKENS,
  MAX_TOTAL_STEPS,
  MAX_TURN_STEPS,
  MAX_UNKNOWN_ERRORS_PER_REQUEST,
  STEP_TIMEOUT_MS,
  STUCK_LOOP_SAME_FILE_THRESHOLD,
  STUCK_LOOP_TURNS_BETWEEN_REMINDERS,
  TOOL_TIMEOUT_MS,
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
  maxConsecutiveToolFailures: number;
  // Workspace commands
  installCommand?: WorkspaceCommand;
  formatCommand?: WorkspaceCommand;
  lintCommand?: WorkspaceCommand;
  // Agent reminders
  stuckLoopSameFileThreshold: number;
  stuckLoopTurnsBetweenReminders: number;
  budgetNudgeThresholds: readonly number[];
};

export const defaultLifecyclePolicy: LifecyclePolicy = {
  totalMaxSteps: MAX_TOTAL_STEPS,
  turnMaxSteps: MAX_TURN_STEPS,
  stepTimeoutMs: STEP_TIMEOUT_MS,
  maxUnknownErrorsPerRequest: MAX_UNKNOWN_ERRORS_PER_REQUEST,
  toolTimeoutMs: TOOL_TIMEOUT_MS,
  contextMaxTokens: MAX_CONTEXT_TOKENS,
  maxConsecutiveToolFailures: MAX_CONSECUTIVE_TOOL_FAILURES,
  stuckLoopSameFileThreshold: STUCK_LOOP_SAME_FILE_THRESHOLD,
  stuckLoopTurnsBetweenReminders: STUCK_LOOP_TURNS_BETWEEN_REMINDERS,
  budgetNudgeThresholds: BUDGET_NUDGE_THRESHOLDS,
};

export function createLifecyclePolicy(override?: Partial<LifecyclePolicy>): LifecyclePolicy {
  if (!override) return defaultLifecyclePolicy;
  return { ...defaultLifecyclePolicy, ...override };
}
