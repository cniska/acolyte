import { spawnSync } from "node:child_process";
import type { WorkspaceCommand, WorkspaceProfile } from "./workspace-contract";
import { detectWorkspaceProfile } from "./workspace-detectors";

export type CommandResult = { hasErrors: boolean; stdout: string; stderr: string };

export function renderCommandResult(result: CommandResult): string {
  if (!result.stderr) return result.stdout;
  if (!result.stdout) return result.stderr;
  return `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`;
}

// A formatter reports what it rewrote on its way out and exits 0, so both streams are read on
// every path: a success here carries the account of what changed, not just an absence of errors.
export function runCommand(workspace: string, command: WorkspaceCommand, timeoutMs = 30_000): CommandResult {
  const { bin, args } = command;
  const run = spawnSync(bin, [...args], {
    cwd: workspace,
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    encoding: "utf-8",
  });
  const stdout = (run.stdout ?? "").trim();
  const stderr = (run.stderr ?? "").trim();
  // An absent binary is not a workspace failure — the ecosystem was detected, the tool is not
  // installed. Nothing to report and nothing to fix.
  if (run.error && "code" in run.error && run.error.code === "ENOENT") {
    return { hasErrors: false, stdout: "", stderr: "" };
  }
  if (run.error) return { hasErrors: true, stdout, stderr: stderr || String(run.error) };
  return { hasErrors: run.status !== 0, stdout, stderr };
}

export function resolveCommandFiles(command: WorkspaceCommand, filePaths: string[]): WorkspaceCommand {
  const args = command.args.flatMap((arg) => (arg === "$FILES" ? filePaths : [arg]));
  return { bin: command.bin, args };
}

export function runCommandWithFiles(workspace: string, command: WorkspaceCommand, filePaths: string[]): CommandResult {
  if (filePaths.length === 0) return { hasErrors: false, stdout: "", stderr: "" };
  return runCommand(workspace, resolveCommandFiles(command, filePaths));
}

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

// Formatting and linting are lifecycle effects: they run on their own after a write and report
// themselves in the transcript, so nothing here names those commands. What the model cannot
// otherwise know, and does run itself, belongs here.
export function createWorkspaceInstructions(profile: WorkspaceProfile): string[] {
  const lines: string[] = [];
  if (profile.ecosystem) {
    lines.push(`This is a ${profile.ecosystem} project.`);
  }
  if (profile.packageManager) {
    lines.push(`It uses ${profile.packageManager}. Use it for install and run commands.`);
  }
  if (profile.testCommand) {
    // The tool substitutes the file placeholder, so the model is told the runner it will invoke
    // rather than a command string it cannot use as written.
    const runner = formatWorkspaceCommand(resolveCommandFiles(profile.testCommand, []));
    lines.push(`Its tests run under \`${runner}\`, which the test tool invokes.`);
  }
  if (profile.installCommand) {
    lines.push(
      "The harness installs dependencies when they are missing, so a fresh checkout is ready before I touch it.",
    );
  }
  if (profile.formatCommand || profile.lintCommand) {
    lines.push("The harness formats and lints every file I write, straight after the write. I leave that to it.");
  }
  return lines;
}
