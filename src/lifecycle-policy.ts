import {
  INITIAL_MAX_STEPS,
  MAX_NUDGES_PER_GENERATION,
  MAX_UNKNOWN_ERRORS_PER_REQUEST,
  STEP_TIMEOUT_MS,
  TOOL_TIMEOUT_MS,
  TOTAL_MAX_STEPS,
} from "./lifecycle-constants";
import type { WorkspaceCommand } from "./workspace-profile";

export type LifecyclePolicy = {
  totalMaxSteps: number;
  initialMaxSteps: number;
  stepTimeoutMs: number;
  maxUnknownErrorsPerRequest: number;
  maxNudgesPerGeneration: number;
  toolTimeoutMs: number;
  formatCommand?: WorkspaceCommand;
  lintCommand?: WorkspaceCommand;
};

export const defaultLifecyclePolicy: LifecyclePolicy = {
  totalMaxSteps: TOTAL_MAX_STEPS,
  initialMaxSteps: INITIAL_MAX_STEPS,
  stepTimeoutMs: STEP_TIMEOUT_MS,
  maxUnknownErrorsPerRequest: MAX_UNKNOWN_ERRORS_PER_REQUEST,
  maxNudgesPerGeneration: MAX_NUDGES_PER_GENERATION,
  toolTimeoutMs: TOOL_TIMEOUT_MS,
};

export function resolveLifecyclePolicy(override?: Partial<LifecyclePolicy>): LifecyclePolicy {
  if (!override) return defaultLifecyclePolicy;
  return { ...defaultLifecyclePolicy, ...override };
}
