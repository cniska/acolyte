import { existsSync } from "node:fs";
import { join } from "node:path";
import { configDir, type Env } from "./paths";
import { getPluginLoadDiagnostics } from "./plugin-ops";
import { loadProjectRulesPrompt } from "./project-rules";
import { getLoadedSkills, getSkillLoadDiagnostics } from "./skill-ops";
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

  if (loadProjectRulesPrompt(cwd).trim().length === 0) diagnostics["resources.prompt.agents"] = "missing_or_unreadable";

  const skills = getLoadedSkills();
  const skillDiagnostics = getSkillLoadDiagnostics();
  if (skillDiagnostics.invalid > 0) diagnostics["resources.skills.invalid"] = skillDiagnostics.invalid;
  if (skillDiagnostics.duplicates > 0) diagnostics["resources.skills.duplicates"] = skillDiagnostics.duplicates;
  if (skillDiagnostics.readErrors > 0) diagnostics["resources.skills.read_errors"] = skillDiagnostics.readErrors;
  if (skillDiagnostics.scannedDirs > 0 && skillDiagnostics.loaded === 0 && skills.length === 0)
    diagnostics["resources.skills.status"] = "no_valid_skills_loaded";

  const pluginDiagnostics = getPluginLoadDiagnostics();
  if (pluginDiagnostics.loaded > 0) diagnostics["resources.plugins.loaded"] = pluginDiagnostics.loaded;
  if (pluginDiagnostics.rejected > 0) diagnostics["resources.plugins.rejected"] = pluginDiagnostics.rejected;
  if (pluginDiagnostics.duplicates > 0) diagnostics["resources.plugins.duplicates"] = pluginDiagnostics.duplicates;
  if (pluginDiagnostics.mcpDisabled > 0) diagnostics["resources.plugins.mcp_disabled"] = pluginDiagnostics.mcpDisabled;
  if (pluginDiagnostics.skippedServers > 0)
    diagnostics["resources.plugins.servers_skipped"] = pluginDiagnostics.skippedServers;
  if (pluginDiagnostics.skillsInvalid > 0)
    diagnostics["resources.plugins.skills_invalid"] = pluginDiagnostics.skillsInvalid;
  if (pluginDiagnostics.skillsDuplicates > 0)
    diagnostics["resources.plugins.skills_duplicates"] = pluginDiagnostics.skillsDuplicates;

  return diagnostics;
}
