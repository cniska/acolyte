import { z } from "zod";

const parseBoolSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
  return value;
}, z.boolean());

export const featureFlagsSchema = z.object({
  // When enabled, keep a single deterministic project-memory record in sync with AGENTS.md.
  syncAgents: parseBoolSchema.optional(),
  // When enabled, capture write-tool checkpoints under .acolyte/undo/<sessionId> and allow undo tools.
  undoCheckpoints: parseBoolSchema.optional(),
});

export type FeatureFlags = z.infer<typeof featureFlagsSchema>;

export const resolvedFeatureFlagsSchema = z.object({
  syncAgents: parseBoolSchema.optional().default(false),
  undoCheckpoints: parseBoolSchema.optional().default(false),
});

export type ResolvedFeatureFlags = z.infer<typeof resolvedFeatureFlagsSchema>;

export const DEFAULT_FEATURE_FLAGS: ResolvedFeatureFlags = resolvedFeatureFlagsSchema.parse({});
