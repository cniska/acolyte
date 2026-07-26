import { z } from "zod";
import type { ToolCallRecord } from "./tool-contract";

export const taskActivitySchema = z.object({
  filesChanged: z.array(z.string()),
  commands: z.array(z.object({ command: z.string(), failed: z.boolean() })),
  errors: z.array(z.object({ tool: z.string(), detail: z.string() })),
});

export type TaskActivity = z.infer<typeof taskActivitySchema>;

// A single command can carry a large inline payload (heredoc, long -m body); cap it so one
// call cannot bloat the distill prompt against the flat memory budget.
const MAX_COMMAND_CHARS = 200;

function clampCommand(command: string): string {
  return command.length > MAX_COMMAND_CHARS ? `${command.slice(0, MAX_COMMAND_CHARS - 1)}…` : command;
}

function argPaths(args: Record<string, unknown>): string[] {
  const path = args.path;
  if (typeof path === "string") return [path];
  const paths = args.paths;
  if (Array.isArray(paths)) return paths.filter((p): p is string => typeof p === "string");
  return [];
}

// Digest of one turn's work, derived from the tool call log: files a write tool actually
// changed, shell commands and whether they failed, and non-command failures. Reads are
// exploration noise and excluded; the durable fact is what the turn changed and what broke.
export function createTaskActivity(callLog: readonly ToolCallRecord[], writeTools: ReadonlySet<string>): TaskActivity {
  const filesChanged: string[] = [];
  const seenFiles = new Set<string>();
  const commands: TaskActivity["commands"] = [];
  const errors: TaskActivity["errors"] = [];

  for (const entry of callLog) {
    const failed = entry.status === "failed" || (typeof entry.exitCode === "number" && entry.exitCode !== 0);
    const command = entry.command ?? null;

    if (command) commands.push({ command: clampCommand(command), failed });

    if (writeTools.has(entry.toolName) && !failed) {
      for (const p of argPaths(entry.args)) {
        if (seenFiles.has(p)) continue;
        seenFiles.add(p);
        filesChanged.push(p);
      }
    }

    if (failed && !command) {
      errors.push({ tool: entry.toolName, detail: argPaths(entry.args)[0] ?? "" });
    }
  }

  return { filesChanged, commands, errors };
}

export function renderTaskActivity(activity: TaskActivity): string {
  const sections: string[] = [];
  if (activity.filesChanged.length > 0) {
    sections.push(`Files changed:\n${activity.filesChanged.map((f) => `- ${f}`).join("\n")}`);
  }
  if (activity.commands.length > 0) {
    const lines = activity.commands.map((c) => `- ${c.command}${c.failed ? " (failed)" : ""}`);
    sections.push(`Commands:\n${lines.join("\n")}`);
  }
  if (activity.errors.length > 0) {
    const lines = activity.errors.map((e) => (e.detail ? `- ${e.tool}: ${e.detail}` : `- ${e.tool}`));
    sections.push(`Errors:\n${lines.join("\n")}`);
  }
  return sections.join("\n\n");
}
