import { execSync } from "node:child_process";

export type LintResult = { hasErrors: boolean; output: string };

export function lintFiles(workspace: string, filePaths: string[]): LintResult {
  if (filePaths.length === 0) return { hasErrors: false, output: "" };
  try {
    const quoted = filePaths.map((f) => `"${f.replace(/"/g, '\\"')}"`).join(" ");
    execSync(`bunx biome check ${quoted}`, {
      cwd: workspace,
      timeout: 10_000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { hasErrors: false, output: "" };
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error ? String((error as { stderr: unknown }).stderr) : "";
    if (stderr.includes("not found") || stderr.includes("ENOENT")) {
      return { hasErrors: false, output: "" };
    }
    const stdout =
      error instanceof Error && "stdout" in error ? String((error as { stdout: unknown }).stdout) : String(error);
    return { hasErrors: true, output: stdout.trim() };
  }
}
