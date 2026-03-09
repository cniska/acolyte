import {
  INITIAL_MAX_STEPS,
  MAX_EVALUATOR_CHAIN_REGENERATIONS,
  MAX_PLAN_STEPS,
  MAX_REGENERATIONS_PER_EVALUATOR,
  MAX_REGENERATIONS_PER_REQUEST,
  MAX_UNKNOWN_ERRORS_PER_REQUEST,
  PLAN_PHASE_ENABLED,
  STEP_TIMEOUT_MS,
  TIMEOUT_RECOVERY_MAX_STEPS,
  TIMEOUT_RECOVERY_TIMEOUT_MS,
  TOTAL_MAX_STEPS,
  VERIFY_MAX_STEPS,
} from "./lifecycle-constants";

export type LifecyclePolicy = {
  totalMaxSteps: number;
  initialMaxSteps: number;
  stepTimeoutMs: number;
  timeoutRecoveryMaxSteps: number;
  timeoutRecoveryTimeoutMs: number;
  verifyMaxSteps: number;
  planPhase: boolean;
  planMaxSteps: number;
  maxUnknownErrorsPerRequest: number;
  maxRegenerationsPerRequest: number;
  maxRegenerationsPerEvaluator: number;
  maxEvaluatorChainRegenerations: number;
};

export const defaultLifecyclePolicy: LifecyclePolicy = {
  totalMaxSteps: TOTAL_MAX_STEPS,
  initialMaxSteps: INITIAL_MAX_STEPS,
  stepTimeoutMs: STEP_TIMEOUT_MS,
  timeoutRecoveryMaxSteps: TIMEOUT_RECOVERY_MAX_STEPS,
  timeoutRecoveryTimeoutMs: TIMEOUT_RECOVERY_TIMEOUT_MS,
  verifyMaxSteps: VERIFY_MAX_STEPS,
  planPhase: PLAN_PHASE_ENABLED,
  planMaxSteps: MAX_PLAN_STEPS,
  maxUnknownErrorsPerRequest: MAX_UNKNOWN_ERRORS_PER_REQUEST,
  maxRegenerationsPerRequest: MAX_REGENERATIONS_PER_REQUEST,
  maxRegenerationsPerEvaluator: MAX_REGENERATIONS_PER_EVALUATOR,
  maxEvaluatorChainRegenerations: MAX_EVALUATOR_CHAIN_REGENERATIONS,
};

export function resolveLifecyclePolicy(override?: Partial<LifecyclePolicy>): LifecyclePolicy {
  if (!override) return defaultLifecyclePolicy;
  return { ...defaultLifecyclePolicy, ...override };
}
