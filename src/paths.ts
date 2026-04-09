import { homedir } from "node:os";
import { join } from "node:path";

export type Env = Record<string, string | undefined>;

export function resolveHomeDir(env: Env = process.env): string {
  const envHome = env.HOME;
  if (envHome && envHome.trim().length > 0) return envHome;
  return homedir();
}

function isLinux(): boolean {
  return process.platform === "linux";
}

export function configDir(env: Env = process.env): string {
  if (isLinux()) {
    const xdg = env.XDG_CONFIG_HOME;
    return join(xdg && xdg.trim().length > 0 ? xdg : join(resolveHomeDir(env), ".config"), "acolyte");
  }
  return join(resolveHomeDir(env), ".acolyte");
}

export function dataDir(env: Env = process.env): string {
  if (isLinux()) {
    const xdg = env.XDG_DATA_HOME;
    return join(xdg && xdg.trim().length > 0 ? xdg : join(resolveHomeDir(env), ".local", "share"), "acolyte");
  }
  return join(resolveHomeDir(env), ".acolyte");
}

export function stateDir(env: Env = process.env): string {
  if (isLinux()) {
    const xdg = env.XDG_STATE_HOME;
    return join(xdg && xdg.trim().length > 0 ? xdg : join(resolveHomeDir(env), ".local", "state"), "acolyte");
  }
  return join(resolveHomeDir(env), ".acolyte");
}
