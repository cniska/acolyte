import { z } from "zod";

export const activeSkillSchema = z.object({
  name: z.string().min(1),
  instructions: z.string().min(1),
});

export type ActiveSkill = z.infer<typeof activeSkillSchema>;

export const activeSkillsSchema = z.array(activeSkillSchema);

export function isActiveSkillsPayload(value: unknown): value is ActiveSkill[] {
  return activeSkillsSchema.safeParse(value).success;
}

export const skillSourceSchema = z.enum(["bundled", "project"]);
export type SkillSource = z.infer<typeof skillSourceSchema>;

export const skillMetaSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1).max(1024),
  path: z.string().min(1),
  source: skillSourceSchema,
});
export type SkillMeta = z.infer<typeof skillMetaSchema>;

export const skillLoadDiagnosticsSchema = z.object({
  scannedDirs: z.number().int().nonnegative(),
  loaded: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  readErrors: z.number().int().nonnegative(),
  missingSkillFiles: z.number().int().nonnegative(),
  scannedAt: z.string().nullable(),
});
export type SkillLoadDiagnostics = z.infer<typeof skillLoadDiagnosticsSchema>;

const SKILL_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function createEmptySkillLoadDiagnostics(): SkillLoadDiagnostics {
  return {
    scannedDirs: 0,
    loaded: 0,
    invalid: 0,
    duplicates: 0,
    readErrors: 0,
    missingSkillFiles: 0,
    scannedAt: null,
  };
}

export function validateSkillName(name: string, dirName: string): string | null {
  if (name.length === 0 || name.length > 64) return `name must be 1-64 characters (got ${name.length})`;
  if (!SKILL_NAME_RE.test(name)) return `name contains invalid characters: "${name}"`;
  if (name.includes("--")) return `name must not contain consecutive hyphens: "${name}"`;
  if (name !== dirName) return `name "${name}" must match directory "${dirName}"`;
  return null;
}
