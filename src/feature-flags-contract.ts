import { z } from "zod";

const parseBoolSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
  return value;
}, z.boolean());

export const featureFlagsSchema = z.object({
  // When enabled, capture write-tool checkpoints under .acolyte/undo/<sessionId> and allow undo tools.
  undoCheckpoints: parseBoolSchema.optional(),
  // When enabled, allow managing workspaces (git worktrees) from chat commands.
  workspaces: parseBoolSchema.optional(),
  // When enabled, use the cloud API for memory and session storage.
  cloudSync: parseBoolSchema.optional(),
  // When enabled, connect to MCP servers configured in .mcp.json.
  mcp: parseBoolSchema.optional(),
  // When enabled, load Agent Plugins from .agents/plugins in the workspace and the home directory.
  plugins: parseBoolSchema.optional(),
});

export type FeatureFlags = z.infer<typeof featureFlagsSchema>;

export const featureFlagNameSchema = z.enum(
  Object.keys(featureFlagsSchema.shape) as [keyof FeatureFlags, ...(keyof FeatureFlags)[]],
);

export type FeatureFlagName = z.infer<typeof featureFlagNameSchema>;

export const resolvedFeatureFlagsSchema = z.object({
  undoCheckpoints: parseBoolSchema.optional().default(false),
  workspaces: parseBoolSchema.optional().default(false),
  cloudSync: parseBoolSchema.optional().default(false),
  mcp: parseBoolSchema.optional().default(false),
  plugins: parseBoolSchema.optional().default(false),
});

export type ResolvedFeatureFlags = z.infer<typeof resolvedFeatureFlagsSchema>;

export const DEFAULT_FEATURE_FLAGS: ResolvedFeatureFlags = resolvedFeatureFlagsSchema.parse({});
