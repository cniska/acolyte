import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export type Env = Record<string, string | undefined>;

export type Platform = "darwin" | "linux";

export function resolveHomeDir(env: Env = process.env): string {
  const envHome = env.HOME;
  if (envHome && envHome.trim().length > 0) return envHome;
  return homedir();
}

function resolvePlatform(): Platform {
  return process.platform === "linux" ? "linux" : "darwin";
}

function xdgDir(env: Env, key: string, fallback: string): string {
  const value = env[key];
  if (value && value.trim().length > 0 && isAbsolute(value)) return join(value, "acolyte");
  return join(fallback, "acolyte");
}

export function configDir(env: Env = process.env, platform: Platform = resolvePlatform()): string {
  if (platform === "linux") {
    return xdgDir(env, "XDG_CONFIG_HOME", join(resolveHomeDir(env), ".config"));
  }
  return join(resolveHomeDir(env), ".acolyte");
}

export function dataDir(env: Env = process.env, platform: Platform = resolvePlatform()): string {
  if (platform === "linux") {
    return xdgDir(env, "XDG_DATA_HOME", join(resolveHomeDir(env), ".local", "share"));
  }
  return join(resolveHomeDir(env), ".acolyte");
}

export function stateDir(env: Env = process.env, platform: Platform = resolvePlatform()): string {
  if (platform === "linux") {
    return xdgDir(env, "XDG_STATE_HOME", join(resolveHomeDir(env), ".local", "state"));
  }
  return join(resolveHomeDir(env), ".acolyte");
}
