import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { compactDetail } from "./compact-text";
import { parseExitCode, runShellCommand } from "./shell-ops";
import { normalizePath } from "./tool-arg-paths";
import { createTool, type ToolkitDeps, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";
import { compactToolOutput } from "./tool-output";
import { emitParts, shellHeadTailParts } from "./tool-output-format";
import { formatWorkspaceCommand } from "./workspace-profile";

type ResolvedTestTargets = {
  files: string[];
  inferred: Array<{ source: string; targets: string[] }>;
  unresolved: string[];
};

function isTestFilePath(path: string): boolean {
  const base = basename(path);
  return (
    base.includes(".test.") ||
    base.includes(".spec.") ||
    base.endsWith("_test.go") ||
    base.endsWith("_test.py") ||
    /^test_.+\.py$/i.test(base)
  );
}

function pushCandidate(out: string[], value: string): void {
  const normalized = normalizePath(value);
  if (normalized.length === 0 || out.includes(normalized)) return;
  out.push(normalized);
}

function directCounterpartCandidates(path: string, ecosystem?: string): string[] {
  const normalized = normalizePath(path);
  const ext = extname(normalized);
  if (ext.length === 0) return [];

  const dir = dirname(normalized);
  const base = basename(normalized, ext);
  const sameDir = dir === "." ? "" : `${dir}/`;
  const candidates: string[] = [];

  pushCandidate(candidates, `${sameDir}${base}.test${ext}`);
  pushCandidate(candidates, `${sameDir}${base}.spec${ext}`);
  pushCandidate(candidates, `${sameDir}__tests__/${base}.test${ext}`);
  pushCandidate(candidates, `${sameDir}__tests__/${base}.spec${ext}`);

  if (ecosystem === "go" || ext === ".go") {
    pushCandidate(candidates, `${sameDir}${base}_test${ext}`);
  }

  if (ecosystem === "python" || ext === ".py") {
    pushCandidate(candidates, `${sameDir}test_${base}${ext}`);
    pushCandidate(candidates, `${sameDir}${base}_test${ext}`);
    pushCandidate(candidates, `tests/test_${base}${ext}`);
    pushCandidate(candidates, `tests/${base}_test${ext}`);
  }

  if (ecosystem === "rust" || ext === ".rs") {
    pushCandidate(candidates, `tests/${base}${ext}`);
  }

  return candidates;
}

function resolveRequestedTestFiles(workspace: string, files: string[], ecosystem?: string): ResolvedTestTargets {
  const resolved: string[] = [];
  const inferred: Array<{ source: string; targets: string[] }> = [];
  const unresolved: string[] = [];

  for (const rawFile of files) {
    const trimmed = rawFile.trim();
    if (trimmed.length === 0) continue;
    const normalized = normalizePath(trimmed);

    if (isTestFilePath(normalized)) {
      pushCandidate(resolved, normalized);
      continue;
    }

    const matches = directCounterpartCandidates(normalized, ecosystem).filter((candidate) =>
      existsSync(join(workspace, candidate)),
    );
    if (matches.length > 0) {
      inferred.push({ source: normalized, targets: matches });
      for (const match of matches) pushCandidate(resolved, match);
      continue;
    }

    unresolved.push(normalized);
  }

  return { files: resolved, inferred, unresolved };
}

function renderResolutionNote(resolution: ResolvedTestTargets): string {
  const lines: string[] = [];
  if (resolution.inferred.length > 0) {
    lines.push(
      `Resolved direct counterpart tests: ${resolution.inferred
        .map(({ source, targets }) => `${source} -> ${targets.join(", ")}`)
        .join("; ")}`,
    );
  }
  if (resolution.unresolved.length > 0) {
    lines.push(`No direct counterpart test file found for: ${resolution.unresolved.join(", ")}`);
  }
  return lines.join("\n");
}

function toolArgsForResolution(resolution: ResolvedTestTargets): { files: string[] } {
  return { files: resolution.files };
}

function createRunTestsTool(deps: ToolkitDeps, input: ToolkitInput) {
  const { session, onOutput } = input;

  return createTool({
    id: "test-run",
    toolkit: "test",
    labelKey: "tool.label.test_run",
    category: "execute",
    permissions: ["test"],
    description:
      "Run the project's test runner against specific files. The test command is auto-detected from the workspace.",
    instruction:
      "Use `test-run` to validate changes with specific test files or direct source-file counterparts. It resolves sibling/direct counterpart tests when available. Do not run the full suite.",
    inputSchema: z.object({
      files: z.array(z.string().min(1)).min(1),
      timeoutMs: z.number().int().min(500).max(120000).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("test-run"),
      command: z.string(),
      exitCode: z.number().int().optional(),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      const profile = session.workspaceProfile;
      const testCommand = profile?.testCommand;
      if (!testCommand) {
        return { kind: "test-run" as const, command: "", exitCode: 1, output: "No test command detected." };
      }

      const resolution = resolveRequestedTestFiles(input.workspace, toolInput.files, profile?.ecosystem);
      const resolutionNote = renderResolutionNote(resolution);
      if (resolution.files.length === 0) {
        const output = resolutionNote || "No matching test files found for the requested inputs.";
        return runTool(session, "test-run", toolCallId, toolArgsForResolution(resolution), async (callId) => {
          onOutput({
            toolName: "test-run",
            content: { kind: "tool-header", labelKey: "tool.label.test_run", detail: compactDetail(output) },
            toolCallId: callId,
          });
          return { kind: "test-run" as const, command: "", exitCode: 1, output };
        });
      }

      const resolvedArgs = testCommand.args.flatMap((arg) => (arg === "$FILES" ? resolution.files : [arg]));
      const command = formatWorkspaceCommand({ bin: testCommand.bin, args: resolvedArgs });

      return runTool(session, "test-run", toolCallId, toolArgsForResolution(resolution), async (callId) => {
        onOutput({
          toolName: "test-run",
          content: { kind: "tool-header", labelKey: "tool.label.test_run", detail: compactDetail(command) },
          toolCallId: callId,
        });
        const streamed: Array<{ stream: "stdout" | "stderr"; text: string }> = [];
        const rawResult = await runShellCommand(
          input.workspace,
          command,
          toolInput.timeoutMs ?? 60_000,
          ({ stream, text }) => {
            for (const line of text.split("\n").filter(Boolean)) {
              streamed.push({ stream, text: line });
            }
          },
        );
        const previewParts = shellHeadTailParts(streamed);
        emitParts(previewParts, "test-run", onOutput, callId);

        const result = compactToolOutput(rawResult, deps.outputBudget.run);
        const output = resolutionNote.length > 0 ? `${resolutionNote}\n\n${result}` : result;
        return { kind: "test-run" as const, command, exitCode: parseExitCode(rawResult), output };
      });
    },
  });
}

export function createTestToolkit(deps: ToolkitDeps, input: ToolkitInput) {
  return {
    runTests: createRunTestsTool(deps, input),
  };
}
