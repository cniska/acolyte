import { execFileSync } from "node:child_process";
import type { WorkspaceCommand } from "./workspace-profile";

export type CommandResult = { hasErrors: boolean; output: string };

export function runCommandWithFiles(workspace: string, command: WorkspaceCommand, filePaths: string[]): CommandResult {
  if (filePaths.length === 0) return { hasErrors: false, output: "" };
  return runCommand(workspace, { bin: command.bin, args: [...command.args, "--", ...filePaths] });
}

export function runCommand(workspace: string, command: WorkspaceCommand): CommandResult {
  const { bin, args } = command;
  try {
    execFileSync(bin, [...args], {
      cwd: workspace,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { hasErrors: false, output: "" };
  } catch (error) {
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
    if (stderr.includes("not found") || stderr.includes("ENOENT")) {
      return { hasErrors: false, output: "" };
    }
    const stdout =
      typeof error === "object" && error !== null && "stdout" in error ? String(error.stdout) : String(error);
    return { hasErrors: true, output: stdout.trim() };
  }
}

export function lintFiles(workspace: string, filePaths: string[], command: WorkspaceCommand): CommandResult {
  return runCommandWithFiles(workspace, command, filePaths);
}
