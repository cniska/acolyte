export type MemoryPolicy = {
  /** Max retries when reflection output exceeds token budget. */
  /** Number of recent messages passed to the observer agent. */
  contextMessageWindow: number;
  /** Emit quality warning after this many consecutive commits with malformed tags. */
  malformedStreakWarningThreshold: number;
};

export const defaultMemoryPolicy: MemoryPolicy = {
  contextMessageWindow: 20,
  malformedStreakWarningThreshold: 3,
};

export function resolveMemoryPolicy(override?: Partial<MemoryPolicy>): MemoryPolicy {
  if (!override) return defaultMemoryPolicy;
  return { ...defaultMemoryPolicy, ...override };
}
