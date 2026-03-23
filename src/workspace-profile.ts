import { detectWorkspaceProfile } from "./workspace-detectors";

export type WorkspaceCommand = { readonly bin: string; readonly args: readonly string[] };

export type WorkspaceProfile = {
  ecosystem?: string;
  packageManager?: string;
  lintCommand?: WorkspaceCommand;
  formatCommand?: WorkspaceCommand;
  verifyCommand?: WorkspaceCommand;
  lineWidth?: number;
};

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
    const cmd = `${profile.formatCommand.bin} ${profile.formatCommand.args.join(" ")}`.trim();
    lines.push(`Format command: \`${cmd}\`. Run this to auto-fix lint or format issues before manual repairs.`);
  }
  if (profile.packageManager) {
    lines.push(`This project uses ${profile.packageManager}. Use it for install and run commands.`);
  }
  return lines;
}
