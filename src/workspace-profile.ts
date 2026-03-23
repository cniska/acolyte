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
