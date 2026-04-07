import { homedir } from "node:os";

export function resolveHomeDir(env = process.env): string {
  const envHome = env.HOME;
  if (envHome && envHome.trim().length > 0) return envHome;
  return homedir();
}
