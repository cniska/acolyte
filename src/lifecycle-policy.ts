import {
  INITIAL_MAX_STEPS,
  MAX_NUDGES_PER_GENERATION,
  MAX_REGENERATIONS_PER_REQUEST,
  MAX_UNKNOWN_ERRORS_PER_REQUEST,
  STEP_TIMEOUT_MS,
  TOOL_TIMEOUT_MS,
  TOTAL_MAX_STEPS,
  VERIFY_MAX_STEPS,
} from "./lifecycle-constants";
import type { LintCommand } from "./lint-reflection";

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
  /** Lint command to run after writes. Undefined disables lint evaluation. */
  lintCommand?: LintCommand;
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
};

export function resolveLifecyclePolicy(override?: Partial<LifecyclePolicy>): LifecyclePolicy {
  if (!override) return defaultLifecyclePolicy;
  return { ...defaultLifecyclePolicy, ...override };
}
