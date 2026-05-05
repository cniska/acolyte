export type WorkspaceCommand = { readonly bin: string; readonly args: readonly string[] };

export type WorkspaceProfile = {
  ecosystem?: string;
  packageManager?: string;
  installCommand?: WorkspaceCommand;
  depsDir?: string;
  lintCommand?: WorkspaceCommand;
  formatCommand?: WorkspaceCommand;
  testCommand?: WorkspaceCommand;
};
