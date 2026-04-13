import { existsSync } from "node:fs";
import { join } from "node:path";
import { configDir, type Env } from "./paths";
import { getLoadedSkills, getSkillLoadDiagnostics } from "./skills";
import { loadAgentsPrompt } from "./soul";
import type { StatusFields } from "./status-contract";

function hasConfigFileCollision(scopeDir: string): boolean {
  return existsSync(join(scopeDir, "config.toml")) && existsSync(join(scopeDir, "config.json"));
}

export function collectResourceDiagnostics(options?: { cwd?: string; env?: Env }): StatusFields {
  const cwd = options?.cwd ?? process.cwd();
  const userConfigDir = configDir(options?.env);
  const diagnostics: StatusFields = {};

  const collisionScopes: string[] = [];
  if (hasConfigFileCollision(join(cwd, ".acolyte"))) collisionScopes.push("project");
  if (hasConfigFileCollision(userConfigDir)) collisionScopes.push("user");
  if (collisionScopes.length > 0) diagnostics["resources.config.collisions"] = collisionScopes.join(",");

  if (loadAgentsPrompt(cwd).trim().length === 0) diagnostics["resources.prompt.agents"] = "missing_or_unreadable";

  const skills = getLoadedSkills();
  const skillDiagnostics = getSkillLoadDiagnostics();
  if (skillDiagnostics.invalid > 0) diagnostics["resources.skills.invalid"] = skillDiagnostics.invalid;
  if (skillDiagnostics.duplicates > 0) diagnostics["resources.skills.duplicates"] = skillDiagnostics.duplicates;
  if (skillDiagnostics.readErrors > 0) diagnostics["resources.skills.read_errors"] = skillDiagnostics.readErrors;
  if (skillDiagnostics.scannedDirs > 0 && skillDiagnostics.loaded === 0 && skills.length === 0)
    diagnostics["resources.skills.status"] = "no_valid_skills_loaded";

  return diagnostics;
}
