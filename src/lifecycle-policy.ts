import {
  CONSECUTIVE_GUARD_BLOCK_LIMIT,
  INITIAL_MAX_STEPS,
  MAX_NUDGES_PER_GENERATION,
  MAX_REGENERATIONS_PER_REQUEST,
  MAX_UNKNOWN_ERRORS_PER_REQUEST,
  STEP_TIMEOUT_MS,
  TOOL_TIMEOUT_MS,
  TOTAL_MAX_STEPS,
  VERIFY_MAX_STEPS,
} from "./lifecycle-constants";
import type { WorkspaceCommand } from "./workspace-profile";

export type LifecyclePolicy = {
  totalMaxSteps: number;
  initialMaxSteps: number;
  stepTimeoutMs: number;
  verifyMaxSteps: number;
  maxUnknownErrorsPerRequest: number;
  maxRegenerationsPerRequest: number;
  maxNudgesPerGeneration: number;
  /** Per-tool execution timeout in ms. */
  toolTimeoutMs: number;
  /** Stop tool loop after this many consecutive guard blocks. */
  consecutiveGuardBlockLimit: number;
  /** Format command to auto-fix edited files after writes. Undefined skips formatting. */
  formatCommand?: WorkspaceCommand;
  /** Lint command to run after writes. Undefined disables lint evaluation. */
  lintCommand?: WorkspaceCommand;
  /** Verify command to run after writes. Undefined falls back to model-driven verify. */
  verifyCommand?: WorkspaceCommand;
};

export const defaultLifecyclePolicy: LifecyclePolicy = {
  totalMaxSteps: TOTAL_MAX_STEPS,
  initialMaxSteps: INITIAL_MAX_STEPS,
  stepTimeoutMs: STEP_TIMEOUT_MS,
  verifyMaxSteps: VERIFY_MAX_STEPS,
  maxUnknownErrorsPerRequest: MAX_UNKNOWN_ERRORS_PER_REQUEST,
  maxRegenerationsPerRequest: MAX_REGENERATIONS_PER_REQUEST,
  maxNudgesPerGeneration: MAX_NUDGES_PER_GENERATION,
  toolTimeoutMs: TOOL_TIMEOUT_MS,
  consecutiveGuardBlockLimit: CONSECUTIVE_GUARD_BLOCK_LIMIT,
};

export function resolveLifecyclePolicy(override?: Partial<LifecyclePolicy>): LifecyclePolicy {
  if (!override) return defaultLifecyclePolicy;
  return { ...defaultLifecyclePolicy, ...override };
}
