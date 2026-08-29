import { errorMessage } from "./error-contract";
import { runCommand as runProcess } from "./tool-utils";
import type { WorkspaceCommand, WorkspaceProfile } from "./workspace-contract";
import { detectWorkspaceProfile } from "./workspace-detectors";

export type CommandResult = { hasErrors: boolean; stdout: string; stderr: string };

export function renderCommandResult(result: CommandResult): string {
  if (!result.stderr) return result.stdout;
  if (!result.stdout) return result.stderr;
  return `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`;
}

// A formatter reports what it rewrote on its way out and exits 0, so both streams are read on
// every path: a success carries the account of what changed, not just an absence of errors.
export async function runCommand(
  workspace: string,
  command: WorkspaceCommand,
  timeoutMs = 30_000,
): Promise<CommandResult> {
  try {
    const { code, stdout, stderr } = await runProcess([command.bin, ...command.args], workspace, undefined, timeoutMs);
    return { hasErrors: code !== 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    // An absent binary is not a workspace failure — the ecosystem was detected, the tool is not
    // installed. Anything else the spawn refused is a real failure and says so.
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return { hasErrors: false, stdout: "", stderr: "" };
    return { hasErrors: true, stdout: "", stderr: errorMessage(error) };
  }
}

export function resolveCommandFiles(command: WorkspaceCommand, filePaths: string[]): WorkspaceCommand {
  const args = command.args.flatMap((arg) => (arg === "$FILES" ? filePaths : [arg]));
  return { bin: command.bin, args };
}

export async function runCommandWithFiles(
  workspace: string,
  command: WorkspaceCommand,
  filePaths: string[],
): Promise<CommandResult> {
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
