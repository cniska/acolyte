import { execFileSync } from "node:child_process";

export type LintResult = { hasErrors: boolean; output: string };

export type LintCommand = { readonly bin: string; readonly args: readonly string[] };

export function lintFiles(workspace: string, filePaths: string[], command: LintCommand): LintResult {
  if (filePaths.length === 0) return { hasErrors: false, output: "" };
  const { bin, args } = command;
  try {
    execFileSync(bin, [...args, "--", ...filePaths], {
      cwd: workspace,
      timeout: 10_000,
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
