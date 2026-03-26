import { execFileSync } from "node:child_process";
import { detectWorkspaceProfile } from "./workspace-detectors";

export type WorkspaceCommand = { readonly bin: string; readonly args: readonly string[] };

export type CommandResult = { hasErrors: boolean; stdout: string; stderr: string };

export function runCommand(workspace: string, command: WorkspaceCommand, timeoutMs = 30_000): CommandResult {
  const { bin, args } = command;
  try {
    execFileSync(bin, [...args], {
      cwd: workspace,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { hasErrors: false, stdout: "", stderr: "" };
  } catch (error) {
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr).trim() : "";
    if (stderr.includes("not found") || stderr.includes("ENOENT")) {
      return { hasErrors: false, stdout: "", stderr: "" };
    }
    const stdout =
      typeof error === "object" && error !== null && "stdout" in error
        ? String(error.stdout).trim()
        : String(error).trim();
    return { hasErrors: true, stdout, stderr };
  }
}

export function runCommandWithFiles(workspace: string, command: WorkspaceCommand, filePaths: string[]): CommandResult {
  if (filePaths.length === 0) return { hasErrors: false, stdout: "", stderr: "" };
  return runCommand(workspace, { bin: command.bin, args: [...command.args, "--", ...filePaths] });
}

export type WorkspaceProfile = {
  ecosystem?: string;
  packageManager?: string;
  lintCommand?: WorkspaceCommand;
  formatCommand?: WorkspaceCommand;
  verifyCommand?: WorkspaceCommand;
  testCommand?: WorkspaceCommand;
  lineWidth?: number;
};

export function formatWorkspaceCommand(cmd: WorkspaceCommand): string {
  return `${cmd.bin} ${cmd.args.join(" ")}`.trim();
}

const EMPTY_PROFILE: WorkspaceProfile = {};
const cache = new Map<string, WorkspaceProfile>();

export function resolveWorkspaceProfile(workspace?: string): WorkspaceProfile {
  if (!workspace) return EMPTY_PROFILE;
  const cached = cache.get(workspace);
  if (cached) return cached;

  let profile: WorkspaceProfile = EMPTY_PROFILE;
  try {
    profile = detectWorkspaceProfile(workspace) ?? EMPTY_PROFILE;
  } catch {
    // Detection failed — fall back to empty profile.
  }

  cache.set(workspace, profile);
  return profile;
}

export function clearWorkspaceProfileCache(): void {
  cache.clear();
}

export function createWorkspaceInstructions(profile: WorkspaceProfile): string[] {
  const lines: string[] = [];
  if (profile.lineWidth) lines.push(`Keep lines under ${profile.lineWidth} characters.`);
  if (profile.formatCommand) {
    const cmd = formatWorkspaceCommand(profile.formatCommand);
    lines.push(`Format command: \`${cmd}\`. Run this to auto-fix lint or format issues before manual repairs.`);
  }
  if (profile.packageManager) {
    lines.push(`This project uses ${profile.packageManager}. Use it for install and run commands.`);
  }
  return lines;
}
