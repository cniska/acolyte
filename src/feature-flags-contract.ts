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
});

export type FeatureFlags = z.infer<typeof featureFlagsSchema>;
