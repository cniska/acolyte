import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { APP_NAME } from "./app-contract";

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
  if (value && value.trim().length > 0 && isAbsolute(value)) return join(value, APP_NAME);
  return join(fallback, APP_NAME);
}

export function configDir(env: Env = process.env, _platform: Platform = resolvePlatform()): string {
  return xdgDir(env, "XDG_CONFIG_HOME", join(resolveHomeDir(env), ".config"));
}

export function dataDir(env: Env = process.env, _platform: Platform = resolvePlatform()): string {
  return xdgDir(env, "XDG_DATA_HOME", join(resolveHomeDir(env), ".local", "share"));
}

export function stateDir(env: Env = process.env, _platform: Platform = resolvePlatform()): string {
  return xdgDir(env, "XDG_STATE_HOME", join(resolveHomeDir(env), ".local", "state"));
}
