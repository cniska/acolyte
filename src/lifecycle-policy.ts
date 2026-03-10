import {
  INITIAL_MAX_STEPS,
  MAX_REGENERATIONS_PER_REQUEST,
  MAX_UNKNOWN_ERRORS_PER_REQUEST,
  STEP_TIMEOUT_MS,
  TOTAL_MAX_STEPS,
  VERIFY_MAX_STEPS,
} from "./lifecycle-constants";

export type LifecyclePolicy = {
  totalMaxSteps: number;
  initialMaxSteps: number;
  stepTimeoutMs: number;
  verifyMaxSteps: number;
  maxUnknownErrorsPerRequest: number;
  maxRegenerationsPerRequest: number;
};

export const defaultLifecyclePolicy: LifecyclePolicy = {
  totalMaxSteps: TOTAL_MAX_STEPS,
  initialMaxSteps: INITIAL_MAX_STEPS,
  stepTimeoutMs: STEP_TIMEOUT_MS,
  verifyMaxSteps: VERIFY_MAX_STEPS,
  maxUnknownErrorsPerRequest: MAX_UNKNOWN_ERRORS_PER_REQUEST,
  maxRegenerationsPerRequest: MAX_REGENERATIONS_PER_REQUEST,
};

export function resolveLifecyclePolicy(override?: Partial<LifecyclePolicy>): LifecyclePolicy {
  if (!override) return defaultLifecyclePolicy;
  return { ...defaultLifecyclePolicy, ...override };
}
