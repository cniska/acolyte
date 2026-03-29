import {
  CONSECUTIVE_GUARD_BLOCK_LIMIT,
  INITIAL_MAX_STEPS,
  MAX_GUARD_RECOVERY_REGENERATIONS_PER_REQUEST,
  MAX_LINT_REGENERATIONS_PER_REQUEST,
  MAX_NUDGES_PER_GENERATION,
  MAX_REGENERATIONS_PER_REQUEST,
  MAX_REPEATED_FAILURE_REGENERATIONS_PER_REQUEST,
  MAX_TOOL_RECOVERY_REGENERATIONS_PER_REQUEST,
  MAX_UNKNOWN_ERRORS_PER_REQUEST,
  STEP_TIMEOUT_MS,
  TOOL_TIMEOUT_MS,
  TOTAL_MAX_STEPS,
} from "./lifecycle-constants";
import type { RegenerationReason } from "./lifecycle-contract";
import type { WorkspaceCommand } from "./workspace-profile";

export type LifecyclePolicy = {
  totalMaxSteps: number;
  initialMaxSteps: number;
  stepTimeoutMs: number;
  maxUnknownErrorsPerRequest: number;
  maxRegenerationsPerRequest: number;
  maxRegenerationsPerReason: Record<RegenerationReason, number>;
  maxNudgesPerGeneration: number;
  /** Per-tool execution timeout in ms. */
  toolTimeoutMs: number;
  /** Stop tool loop after this many consecutive guard blocks. */
  consecutiveGuardBlockLimit: number;
  /** Format command to auto-fix edited files after writes. Undefined skips formatting. */
  formatCommand?: WorkspaceCommand;
  /** Lint command to run after writes. Undefined disables lint evaluation. */
  lintCommand?: WorkspaceCommand;
};

export const defaultLifecyclePolicy: LifecyclePolicy = {
  totalMaxSteps: TOTAL_MAX_STEPS,
  initialMaxSteps: INITIAL_MAX_STEPS,
  stepTimeoutMs: STEP_TIMEOUT_MS,
  maxUnknownErrorsPerRequest: MAX_UNKNOWN_ERRORS_PER_REQUEST,
  maxRegenerationsPerRequest: MAX_REGENERATIONS_PER_REQUEST,
  maxRegenerationsPerReason: {
    "guard-recovery": MAX_GUARD_RECOVERY_REGENERATIONS_PER_REQUEST,
    lint: MAX_LINT_REGENERATIONS_PER_REQUEST,
    "tool-recovery": MAX_TOOL_RECOVERY_REGENERATIONS_PER_REQUEST,
    "repeated-failure": MAX_REPEATED_FAILURE_REGENERATIONS_PER_REQUEST,
  },
  maxNudgesPerGeneration: MAX_NUDGES_PER_GENERATION,
  toolTimeoutMs: TOOL_TIMEOUT_MS,
  consecutiveGuardBlockLimit: CONSECUTIVE_GUARD_BLOCK_LIMIT,
};

export function resolveLifecyclePolicy(override?: Partial<LifecyclePolicy>): LifecyclePolicy {
  if (!override) return defaultLifecyclePolicy;
  return { ...defaultLifecyclePolicy, ...override };
}
