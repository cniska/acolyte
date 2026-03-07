import { isAbsolute, relative } from "node:path";
import { z } from "zod";
import { appConfig } from "./app-config";
import {
  deleteTextFile,
  editCode,
  editFile,
  fetchWeb,
  findFiles,
  readSnippets,
  runShellCommand,
  scanCode,
  searchFiles,
  searchWeb,
  writeTextFile,
} from "./core-tools";
import { t } from "./i18n";
import { createTool } from "./tool-contract";
import { guardedExecute, streamCallId, withToolError } from "./tool-execution";
import type { SessionContext } from "./tool-guards";
import { compactToolOutput } from "./tool-output";
import {
  emitFindSummary,
  emitResultChunks,
  emitSearchSummary,
  findResultPaths,
  numberedUnifiedDiffLines,
  searchResultSummaryEntries,
  TOOL_OUTPUT_FILES_MAX_ROWS,
  TOOL_OUTPUT_INLINE_FILES_MAX,
  TOOL_OUTPUT_RUN_MAX_ROWS,
  type ToolOutputListener,
} from "./tool-output-format";

export { withToolError } from "./tool-execution";

const WRITE_TOOL_PREVIEW_MAX_LINES = Number.POSITIVE_INFINITY;
const WEB_SEARCH_MAX_RESULTS = 5;

function diffTotals(rawResult: string): { files: number; added: number; removed: number } {
  let files = 0;
  let added = 0;
  let removed = 0;
  for (const line of rawResult.split("\n")) {
    if (line.startsWith("diff --git ")) {
      files += 1;
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) {
      added += 1;
      continue;
    }
    if (line.startsWith("-")) removed += 1;
  }
  return { files, added, removed };
}

function emitDiffSummaryHeader(
  toolName: "edit-file" | "edit-code" | "create-file",
  path: string,
  rawResult: string,
  onOutput: ToolOutputListener,
  toolCallId: string,
): void {
  const { files, added, removed } = diffTotals(rawResult);
  const touchedFiles = files > 0 ? files : 1;
  onOutput({
    toolName,
    content: { kind: "edit-header", path, files: touchedFiles, added, removed },
    toolCallId,
  });
}

function compactDetail(value: string, maxChars = 80): string {
  const single = value.replace(/\s+/g, " ").trim();
  if (single.length <= maxChars) return single;
  return `${single.slice(0, maxChars - 1).trimEnd()}…`;
}

function encodeValue(value: string): string {
  return JSON.stringify(value);
}

function normalizeUniquePaths(paths: string[]): string[] {
  const normalized = paths.map((path) => path.trim()).filter((path) => path.length > 0);
  return Array.from(new Set(normalized));
}

function toDisplayPath(path: string, workspace?: string): string {
  const trimmed = path.trim().replace(/\\/g, "/");
  if (trimmed.startsWith("./")) return trimmed.slice(2);
  if (!workspace || !isAbsolute(trimmed)) return trimmed;
  const rel = relative(workspace, trimmed).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..")) return trimmed;
  return rel || trimmed;
}

function formatDeletePaths(paths: string[]): string {
  if (paths.length === 0) return "";
  if (paths.length === 1) return paths[0] ?? "";
  const shown = paths.slice(0, 3).join(", ");
  const remaining = paths.length - Math.min(paths.length, 3);
  return remaining > 0 ? `${shown} (+${remaining})` : shown;
}

type ReadPathInput = { path: string; start?: number; end?: number };
type NormalizedReadEntry = { path: string; start?: string; end?: string };

function normalizeReadEntries(paths: ReadPathInput[]): NormalizedReadEntry[] {
  const deduped = new Map<string, NormalizedReadEntry>();
  for (const entry of paths) {
    const path = entry.path.trim();
    if (path.length === 0) continue;
    const start = entry.start != null ? String(entry.start) : undefined;
    const end = entry.end != null ? String(entry.end) : undefined;
    const key = `${path}\u0000${start ?? ""}\u0000${end ?? ""}`;
    if (!deduped.has(key)) deduped.set(key, { path, start, end });
  }
  return Array.from(deduped.values());
}

export function webSearchStreamRows(result: string): string {
  const normalizeQuery = (value: string, maxChars = 120): string => {
    const single = value.replace(/\s+/g, " ").trim();
    if (single.length <= maxChars) return single.replace(/\]/g, "\\]");
    return `${single.slice(0, maxChars - 1).trimEnd()}…`.replace(/\]/g, "\\]");
  };
  const lines = result
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return "";

  const noResultsMatch = lines[0]?.match(/^No web results found for:\s*(.+)$/i);
  if (noResultsMatch?.[1]) {
    return [`query=${encodeValue(normalizeQuery(noResultsMatch[1]))} results=0`, "(No output)"].join("\n");
  }

  const headerMatch = lines[0]?.match(/^Web results for:\s*(.+)$/i);
  if (!headerMatch?.[1]) return result;
  const query = headerMatch[1].trim();
  const out: string[] = [];
  const entries: Array<{ rank: number; url?: string }> = [];

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const titleMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (!titleMatch?.[1] || !titleMatch?.[2]) continue;
    const rank = Number.parseInt(titleMatch[1], 10);
    const title = titleMatch[2].trim();
    let url: string | undefined;
    const next = lines[i + 1]?.trim();
    if (next && /^https?:\/\//i.test(next)) {
      url = next;
      i += 1;
    }
    if (!url && title.startsWith("http")) url = title;
    entries.push({ rank: Number.isFinite(rank) ? rank : entries.length + 1, url });
  }

  out.push(`query=${encodeValue(normalizeQuery(query))} results=${entries.length}`);
  const visible = entries.slice(0, WEB_SEARCH_MAX_RESULTS);
  for (const entry of visible)
    out.push(`result rank=${entry.rank}${entry.url ? ` url=${encodeValue(entry.url)}` : ""}`);
  if (entries.length > WEB_SEARCH_MAX_RESULTS)
    out.push(`… +${t("unit.result", { count: entries.length - WEB_SEARCH_MAX_RESULTS })}`);
  if (entries.length === 0) out.push("(No output)");
  return out.join("\n");
}

function createRunCommandTool(workspace: string, session: SessionContext, onOutput: ToolOutputListener) {
  const parseExitCode = (result: string): number | undefined => {
    const match = result.match(/^exit_code=(\d+)$/m);
    if (!match?.[1]) return undefined;
    const value = Number.parseInt(match[1], 10);
    return Number.isNaN(value) ? undefined : value;
  };

  return createTool({
    id: "run-command",
    label: t("tool.label.run"),
    modes: ["work", "verify"],
    description:
      "Run a shell command in the repository and capture stdout/stderr. Never use shell commands as fallbacks for file discovery/reading/editing when dedicated tools are available.",
    instruction:
      "Use `run-command` to run verification after edits and to execute build/test commands. Do not use it for file read/search/edit fallbacks (`cat`, `head`, `tail`, `nl`, `ls`, `grep`, `sed`, `find`, `rg`, `wc`) — use `read-file`, `search-files`, `find-files`, `edit-file`, or `edit-code`.",
    outputSchema: z.object({
      kind: z.literal("run-command"),
      command: z.string().min(1),
      exitCode: z.number().int().optional(),
      output: z.string(),
    }),
    inputSchema: z.object({
      command: z.string().min(1),
      timeoutMs: z.number().int().min(500).max(120000).optional(),
    }),
    execute: async (input) => {
      return withToolError("run-command", () =>
        guardedExecute("run-command", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("run-command");
          onOutput({
            toolName: "run-command",
            content: { kind: "tool-header", label: t("tool.label.run"), detail: compactDetail(input.command) },
            toolCallId,
          });
          const headRows = 2;
          const tailRows = 2;
          const streamed: string[] = [];
          let stdoutBuffer = "";
          let stderrBuffer = "";
          const recordLine = (message: string): void => {
            streamed.push(message);
          };
          const flushBufferLines = (stream: "stdout" | "stderr"): void => {
            const label = stream === "stdout" ? "out" : "err";
            const source = stream === "stdout" ? stdoutBuffer : stderrBuffer;
            let remaining = source;
            while (true) {
              const newlineIndex = remaining.indexOf("\n");
              if (newlineIndex === -1) break;
              const line = remaining.slice(0, newlineIndex).trimEnd();
              remaining = remaining.slice(newlineIndex + 1);
              if (line.length > 0) recordLine(`${label} | ${line}`);
            }
            if (stream === "stdout") {
              stdoutBuffer = remaining;
            } else {
              stderrBuffer = remaining;
            }
          };
          const rawResult = await runShellCommand(
            workspace,
            input.command,
            input.timeoutMs ?? 60_000,
            ({ stream, text }) => {
              if (stream === "stdout") {
                stdoutBuffer += text;
              } else {
                stderrBuffer += text;
              }
              flushBufferLines(stream);
            },
          );
          const flushRemainder = (stream: "stdout" | "stderr"): void => {
            const label = stream === "stdout" ? "out" : "err";
            const remainder = (stream === "stdout" ? stdoutBuffer : stderrBuffer).trimEnd();
            if (remainder.length > 0) recordLine(`${label} | ${remainder}`);
            if (stream === "stdout") {
              stdoutBuffer = "";
            } else {
              stderrBuffer = "";
            }
          };
          flushRemainder("stdout");
          flushRemainder("stderr");
          if (streamed.length > headRows + tailRows) {
            const omitted = streamed.length - (headRows + tailRows);
            for (const line of streamed.slice(0, headRows))
              onOutput({ toolName: "run-command", content: { kind: "text", text: line }, toolCallId });
            onOutput({
              toolName: "run-command",
              content: { kind: "truncated", count: omitted, unit: "lines" },
              toolCallId,
            });
            for (const line of streamed.slice(streamed.length - tailRows))
              onOutput({ toolName: "run-command", content: { kind: "text", text: line }, toolCallId });
          } else if (streamed.length === 0) {
            onOutput({ toolName: "run-command", content: { kind: "no-output" }, toolCallId });
          } else {
            for (const line of streamed.slice(0, TOOL_OUTPUT_RUN_MAX_ROWS)) {
              onOutput({ toolName: "run-command", content: { kind: "text", text: line }, toolCallId });
            }
          }
          const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.run);
          return { kind: "run-command", command: input.command, exitCode: parseExitCode(rawResult), output: result };
        }),
      );
    },
  });
}

function createFindFilesTool(workspace: string, session: SessionContext, onOutput: ToolOutputListener) {
  return createTool({
    id: "find-files",
    label: t("tool.label.find"),
    modes: ["plan", "work"],
    description:
      "Find files in the repository by name or path pattern. Pass `patterns` as an array to batch multiple lookups in one call. To search file contents use `search-files` instead.",
    instruction:
      "Use `find-files` to locate files by name or path pattern. Always pass `patterns` as an array (e.g. [`api.ts`, `store.ts`]).",
    outputSchema: z.object({
      kind: z.literal("find-files"),
      scope: z.string().min(1),
      patterns: z.array(z.string().min(1)),
      matches: z.number().int().nonnegative(),
      paths: z.array(z.string().min(1)),
      output: z.string(),
    }),
    inputSchema: z.object({
      patterns: z.array(z.string().min(1)).min(1),
      maxResults: z.number().int().min(1).max(200).optional(),
    }),
    execute: async (input) => {
      return withToolError("find-files", () =>
        guardedExecute("find-files", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("find-files");
          onOutput({
            toolName: "find-files",
            content: { kind: "tool-header", label: t("tool.label.find") },
            toolCallId,
          });
          const maxResults = input.maxResults ?? 40;
          const count = input.patterns.length;
          const baseBudget = appConfig.agent.toolOutputBudget.findFiles;
          const budget = {
            maxChars: Math.max(400, Math.floor(baseBudget.maxChars / count) * count),
            maxLines: Math.max(20, Math.floor(baseBudget.maxLines / count) * count),
          };
          const result = compactToolOutput(await findFiles(workspace, input.patterns, maxResults), budget);
          const paths = findResultPaths(result);
          emitFindSummary(paths, input.patterns, onOutput, toolCallId, TOOL_OUTPUT_FILES_MAX_ROWS, workspace);
          return {
            kind: "find-files",
            scope: "workspace",
            patterns: input.patterns,
            matches: paths.length,
            paths,
            output: result,
          };
        }),
      );
    },
  });
}

function createSearchFilesTool(workspace: string, session: SessionContext, onOutput: ToolOutputListener) {
  return createTool({
    id: "search-files",
    label: t("tool.label.search"),
    modes: ["plan", "work"],
    description:
      "Search file contents in the repository for text or regex patterns. Optionally scope with `paths` (files or directories). To locate files by name use `find-files` instead.",
    instruction:
      "Use `search-files` to search file contents by text or regex. Always batch related queries via `patterns`; optionally scope with `paths`.",
    outputSchema: z.object({
      kind: z.literal("search-files"),
      scope: z.string().min(1),
      patterns: z.array(z.string().min(1)),
      matches: z.number().int().nonnegative(),
      entries: z.array(z.object({ path: z.string().min(1), hits: z.array(z.string().min(1)) })),
      output: z.string(),
    }),
    inputSchema: z
      .object({
        pattern: z.string().min(1).optional(),
        patterns: z.array(z.string().min(1)).min(1).optional(),
        paths: z.array(z.string().min(1)).min(1).optional(),
        maxResults: z.number().int().min(1).max(200).optional(),
      })
      .refine((input) => Boolean(input.pattern) || Boolean(input.patterns && input.patterns.length > 0), {
        message: "Provide pattern or patterns",
        path: ["patterns"],
      }),
    execute: async (input) => {
      return withToolError("search-files", () =>
        guardedExecute("search-files", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("search-files");
          onOutput({
            toolName: "search-files",
            content: { kind: "tool-header", label: t("tool.label.search") },
            toolCallId,
          });
          const maxResults = input.maxResults ?? 20;
          const patterns =
            input.patterns && input.patterns.length > 0 ? input.patterns : input.pattern ? [input.pattern] : [];
          const result = compactToolOutput(
            await searchFiles(workspace, patterns, maxResults, input.paths),
            appConfig.agent.toolOutputBudget.searchFiles,
          );
          const summaryEntries = searchResultSummaryEntries(result, patterns);
          emitSearchSummary(
            summaryEntries,
            patterns,
            input.paths,
            onOutput,
            toolCallId,
            TOOL_OUTPUT_FILES_MAX_ROWS,
            workspace,
          );
          return {
            kind: "search-files",
            scope: input.paths && input.paths.length > 0 ? "paths" : "workspace",
            patterns,
            matches: summaryEntries.length,
            entries: summaryEntries,
            output: result,
          };
        }),
      );
    },
  });
}

function createScanCodeTool(workspace: string, session: SessionContext, onOutput: ToolOutputListener) {
  return createTool({
    id: "scan-code",
    label: t("tool.label.review"),
    modes: ["plan", "work", "verify"],
    description:
      "Scan files for structural code patterns using AST matching. Pass `paths` as an array of file or directory paths and `patterns` as an array of ast-grep patterns with `$VAR` metavariables (e.g. [`export function $NAME($$$PARAMS)`, `import $SPEC from $MOD`]).",
    instruction:
      "Use `scan-code` for AST pattern matching. Always pass `paths` and `patterns` as arrays. Batch multiple files and patterns in one call (e.g. paths=[`src/a.ts`, `src/b.ts`], patterns=[`export function $NAME`, `import $SPEC from $MOD`]). Metavariable names (`$NAME`, `$ARG`) are wildcards — they match any node, not literal text. Use it to map rename/refactor targets before `edit-code`. For keyword or regex searches prefer `search-files`.",
    outputSchema: z.object({
      kind: z.literal("scan-code"),
      paths: z.array(z.string().min(1)),
      patterns: z.array(z.string().min(1)),
      output: z.string(),
    }),
    inputSchema: z.object({
      paths: z.array(z.string().min(1)).min(1),
      patterns: z.array(z.string().min(1)).min(1),
      language: z.string().optional(),
      maxResults: z.number().int().min(1).max(200).optional(),
    }),
    execute: async (input) => {
      return withToolError("scan-code", () =>
        guardedExecute("scan-code", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("scan-code");
          onOutput({
            toolName: "scan-code",
            content: { kind: "tool-header", label: t("tool.label.review") },
            toolCallId,
          });
          const paths = normalizeUniquePaths(input.paths);
          const unique = Array.from(new Set(paths.map((path) => toDisplayPath(path, workspace))));
          if (unique.length > 0) {
            const shown = unique.slice(0, TOOL_OUTPUT_INLINE_FILES_MAX);
            const remaining = unique.length - shown.length;
            onOutput({
              toolName: "scan-code",
              content: {
                kind: "file-header",
                count: unique.length,
                targets: shown,
                omitted: remaining > 0 ? remaining : undefined,
              },
              toolCallId,
            });
          }
          const baseBudget = appConfig.agent.toolOutputBudget.scanCode;
          const count = paths.length * input.patterns.length;
          const budget = {
            maxChars: Math.max(400, Math.floor(baseBudget.maxChars / count) * count),
            maxLines: Math.max(20, Math.floor(baseBudget.maxLines / count) * count),
          };
          const result = compactToolOutput(
            await scanCode({
              workspace,
              paths,
              pattern: input.patterns,
              language: input.language,
              maxResults: input.maxResults ?? 50,
            }),
            budget,
          );
          return { kind: "scan-code", paths, patterns: input.patterns, output: result };
        }),
      );
    },
  });
}

function createReadFileTool(workspace: string, session: SessionContext, onOutput: ToolOutputListener) {
  return createTool({
    id: "read-file",
    label: t("tool.label.read"),
    modes: ["plan", "work", "verify"],
    description:
      "Read one or more text file snippets by line range. Always pass `paths` as an array of {path, start?, end?} objects, even for a single file. Use to inspect code before editing.",
    instruction:
      "Use `read-file` to inspect code before editing. Pass `paths` as an array; batch multiple reads into one call.",
    outputSchema: z.object({
      kind: z.literal("read-file"),
      paths: z.array(z.object({ path: z.string().min(1), start: z.string().optional(), end: z.string().optional() })),
      output: z.string(),
    }),
    inputSchema: z.object({
      paths: z
        .array(
          z
            .object({
              path: z.string().min(1),
              start: z.number().int().min(1).optional(),
              end: z.number().int().min(1).optional(),
            })
            .refine((entry) => entry.start === undefined || entry.end === undefined || entry.start <= entry.end, {
              message: "start must be less than or equal to end",
              path: ["end"],
            }),
        )
        .min(1),
    }),
    execute: async (input) => {
      return withToolError("read-file", () =>
        guardedExecute("read-file", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("read-file");
          onOutput({
            toolName: "read-file",
            content: { kind: "tool-header", label: t("tool.label.read") },
            toolCallId,
          });
          const entries = normalizeReadEntries(input.paths);
          if (entries.length === 0) throw new Error("Read requires at least one non-empty path");
          const unique = Array.from(new Set(entries.map((entry) => toDisplayPath(entry.path, workspace))));
          if (unique.length > 0) {
            const shown = unique.slice(0, TOOL_OUTPUT_INLINE_FILES_MAX);
            const remaining = unique.length - shown.length;
            onOutput({
              toolName: "read-file",
              content: {
                kind: "file-header",
                count: unique.length,
                targets: shown,
                omitted: remaining > 0 ? remaining : undefined,
              },
              toolCallId,
            });
          }
          const baseBudget = appConfig.agent.toolOutputBudget.read;
          const count = entries.length;
          const budget = {
            maxChars: Math.max(400, Math.floor(baseBudget.maxChars / count) * count),
            maxLines: Math.max(20, Math.floor(baseBudget.maxLines / count) * count),
          };
          const result = compactToolOutput(await readSnippets(workspace, entries), budget);
          return { kind: "read-file", paths: entries, output: result };
        }),
      );
    },
  });
}

function createEditFileTool(workspace: string, session: SessionContext, onOutput: ToolOutputListener) {
  const outputSchema = z.object({
    kind: z.literal("edit-file"),
    path: z.string().min(1),
    files: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    output: z.string(),
  });
  return createTool({
    id: "edit-file",
    label: t("tool.label.edit"),
    modes: ["work"],
    description:
      "Edit an existing file. Pass `edits` as an array of either {find, replace} pairs (for small surgical edits using exact text match) or {startLine, endLine, replace} objects (for larger block replacements). Line numbers MUST come from `read-file` output — do not guess. endLine must not exceed the file length. All edits are applied atomically. You MUST read the file first. For new files, use `create-file`. For code renames or structural edits use `edit-code`.",
    instruction:
      "Use `edit-file` for text edits. For small changes use {find, replace} pairs where `find` is exact text to locate. For larger block changes use {startLine, endLine, replace} with 1-based line numbers from `read-file`. `replace` is *only* the new text for that region — do not include surrounding lines. Batch multiple edits to the same file into one call. If `find` is likely to match multiple locations, switch to `edit-code`.",
    outputSchema,
    inputSchema: z.object({
      path: z.string().min(1),
      edits: z
        .array(
          z.union([
            z.object({ find: z.string().min(1), replace: z.string() }),
            z.object({ startLine: z.number().int().min(1), endLine: z.number().int().min(1), replace: z.string() }),
          ]),
        )
        .min(1),
    }),
    execute: async (input) => {
      return withToolError("edit-file", () =>
        guardedExecute("edit-file", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("edit-file");
          onOutput({
            toolName: "edit-file",
            content: { kind: "tool-header", label: t("tool.label.edit") },
            toolCallId,
          });
          const rawResult = await editFile({
            workspace,
            path: input.path,
            edits: input.edits,
          });
          emitDiffSummaryHeader("edit-file", input.path, rawResult, onOutput, toolCallId);
          for (const content of numberedUnifiedDiffLines(rawResult, WRITE_TOOL_PREVIEW_MAX_LINES))
            onOutput({ toolName: "edit-file", content, toolCallId });
          const totals = diffTotals(rawResult);
          const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.edit);
          return {
            kind: "edit-file",
            path: input.path,
            files: totals.files > 0 ? totals.files : 1,
            added: totals.added,
            removed: totals.removed,
            output: result,
          };
        }),
      );
    },
  });
}

function createCreateFileTool(workspace: string, session: SessionContext, onOutput: ToolOutputListener) {
  return createTool({
    id: "create-file",
    label: t("tool.label.create"),
    modes: ["work"],
    description:
      "Create a new file with full content. For editing existing files, use `edit-file` or `edit-code` instead.",
    instruction: "For new files, call `create-file` with full content directly.",
    outputSchema: z.object({
      kind: z.literal("create-file"),
      path: z.string().min(1),
      files: z.number().int().nonnegative(),
      added: z.number().int().nonnegative(),
      removed: z.number().int().nonnegative(),
      output: z.string(),
    }),
    inputSchema: z.object({
      path: z.string().min(1),
      content: z.string(),
    }),
    execute: async (input) => {
      return withToolError("create-file", () =>
        guardedExecute("create-file", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("create-file");
          onOutput({
            toolName: "create-file",
            content: { kind: "tool-header", label: t("tool.label.create") },
            toolCallId,
          });
          const rawResult = await writeTextFile({
            workspace,
            path: input.path,
            content: input.content,
            overwrite: true,
          });
          emitDiffSummaryHeader("create-file", input.path, rawResult, onOutput, toolCallId);
          for (const content of numberedUnifiedDiffLines(rawResult, WRITE_TOOL_PREVIEW_MAX_LINES))
            onOutput({ toolName: "create-file", content, toolCallId });
          const totals = diffTotals(rawResult);
          const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.create);
          return {
            kind: "create-file",
            path: input.path,
            files: totals.files > 0 ? totals.files : 1,
            added: totals.added,
            removed: totals.removed,
            output: result,
          };
        }),
      );
    },
  });
}

function createAstEditTool(workspace: string, session: SessionContext, onOutput: ToolOutputListener) {
  const outputSchema = z.object({
    kind: z.literal("edit-code"),
    path: z.string().min(1),
    files: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    output: z.string(),
  });
  return createTool({
    id: "edit-code",
    label: t("tool.label.edit"),
    modes: ["work"],
    description:
      "Edit code with AST pattern matching. Pass `edits` as [{pattern, replacement}] using `$VAR` metavariables (e.g. pattern=`console.log($ARG)` replacement=`logger.debug($ARG)`). `path` must be a specific file, not '.' or a directory. For non-code files use `edit-file`.",
    instruction:
      "Use `edit-code` for multi-location code changes, rename/refactor updates, or structural rewrites with AST `edits` array. `path` must be a concrete file path (not `.` or a directory). Prefer `edit-file` for single-location text edits.",
    outputSchema,
    inputSchema: z.object({
      path: z.string().min(1),
      edits: z
        .array(
          z.object({
            pattern: z.string().min(1),
            replacement: z.string(),
          }),
        )
        .min(1),
    }),
    execute: async (input) => {
      return withToolError("edit-code", () =>
        guardedExecute("edit-code", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("edit-code");
          onOutput({
            toolName: "edit-code",
            content: { kind: "tool-header", label: t("tool.label.edit") },
            toolCallId,
          });
          const rawResult = await editCode({
            workspace,
            path: input.path,
            edits: input.edits,
          });
          emitDiffSummaryHeader("edit-code", input.path, rawResult, onOutput, toolCallId);
          for (const content of numberedUnifiedDiffLines(rawResult, WRITE_TOOL_PREVIEW_MAX_LINES))
            onOutput({ toolName: "edit-code", content, toolCallId });
          const totals = diffTotals(rawResult);
          const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.astEdit);
          return {
            kind: "edit-code",
            path: input.path,
            files: totals.files > 0 ? totals.files : 1,
            added: totals.added,
            removed: totals.removed,
            output: result,
          };
        }),
      );
    },
  });
}

function createDeleteFileTool(workspace: string, session: SessionContext, onOutput: ToolOutputListener) {
  return createTool({
    id: "delete-file",
    label: t("tool.label.delete"),
    modes: ["work"],
    description: "Delete a file from the repository.",
    instruction:
      "Use `delete-file` to remove files from the repository. Pass `paths` as an array and batch related deletes in one call.",
    outputSchema: z.object({
      kind: z.literal("delete-file"),
      paths: z.array(z.string().min(1)),
      deleted: z.number().int().nonnegative(),
      output: z.string(),
    }),
    inputSchema: z.object({
      paths: z.array(z.string().min(1)).min(1),
    }),
    execute: async (input) => {
      return withToolError("delete-file", () =>
        guardedExecute("delete-file", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("delete-file");
          const paths = normalizeUniquePaths(input.paths);
          const deleteDetail = paths.length > 0 ? formatDeletePaths(paths) : undefined;
          onOutput({
            toolName: "delete-file",
            content: { kind: "tool-header", label: t("tool.label.delete"), detail: deleteDetail },
            toolCallId,
          });
          const resultParts: string[] = [];
          for (const path of paths) {
            const rawResult = await deleteTextFile({ workspace, path });
            resultParts.push(rawResult);
          }
          const rawResult = resultParts.join("\n\n");
          const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.edit);
          return { kind: "delete-file", paths, deleted: paths.length, output: result };
        }),
      );
    },
  });
}

function createWebSearchTool(session: SessionContext, onOutput: ToolOutputListener) {
  return createTool({
    id: "web-search",
    label: t("tool.label.web_search"),
    modes: ["plan"],
    description:
      "Search the public web for recent information and return top results. Use for questions not answerable from the repo.",
    instruction: "Use `web-search` for external information lookup.",
    outputSchema: z.object({
      kind: z.literal("web-search"),
      query: z.string().min(1),
      output: z.string(),
    }),
    inputSchema: z.object({
      query: z.string().min(1),
      maxResults: z.number().int().min(1).max(10).optional(),
    }),
    execute: async (input) => {
      return withToolError("web-search", () =>
        guardedExecute("web-search", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("web-search");
          onOutput({
            toolName: "web-search",
            content: {
              kind: "tool-header",
              label: t("tool.label.web_search"),
              detail: `"${compactDetail(input.query)}"`,
            },
            toolCallId,
          });
          const result = compactToolOutput(
            await searchWeb(input.query, input.maxResults ?? WEB_SEARCH_MAX_RESULTS),
            appConfig.agent.toolOutputBudget.webSearch,
          );
          emitResultChunks("web-search", webSearchStreamRows(result), onOutput, 80, toolCallId);
          return { kind: "web-search", query: input.query, output: result };
        }),
      );
    },
  });
}

function createWebFetchTool(session: SessionContext, onOutput: ToolOutputListener) {
  return createTool({
    id: "web-fetch",
    label: t("tool.label.web_fetch"),
    modes: ["plan"],
    description:
      "Fetch a public URL and return extracted text content. Use to read docs, API references, or linked resources by URL.",
    instruction: "Use `web-fetch` to read web pages, docs, or API references.",
    outputSchema: z.object({
      kind: z.literal("web-fetch"),
      url: z.string().min(1),
      output: z.string(),
    }),
    inputSchema: z.object({
      url: z.string().min(1),
      maxChars: z.number().int().min(500).max(12000).optional(),
    }),
    execute: async (input) => {
      return withToolError("web-fetch", () =>
        guardedExecute("web-fetch", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("web-fetch");
          onOutput({
            toolName: "web-fetch",
            content: { kind: "tool-header", label: t("tool.label.web_fetch"), detail: input.url },
            toolCallId,
          });
          const result = compactToolOutput(
            await fetchWeb(input.url, input.maxChars ?? 5000),
            appConfig.agent.toolOutputBudget.webFetch,
          );
          return { kind: "web-fetch", url: input.url, output: result };
        }),
      );
    },
  });
}

export type ToolkitInput = {
  workspace: string;
  session: SessionContext;
  onOutput: ToolOutputListener;
};

export function createCoreReadToolkit(input: ToolkitInput) {
  const { workspace, session, onOutput } = input;
  return {
    findFiles: createFindFilesTool(workspace, session, onOutput),
    searchFiles: createSearchFilesTool(workspace, session, onOutput),
    scanCode: createScanCodeTool(workspace, session, onOutput),
    readFile: createReadFileTool(workspace, session, onOutput),
    webSearch: createWebSearchTool(session, onOutput),
    webFetch: createWebFetchTool(session, onOutput),
  };
}

export function createCoreWriteToolkit(input: ToolkitInput) {
  const { workspace, session, onOutput } = input;
  return {
    runCommand: createRunCommandTool(workspace, session, onOutput),
    editCode: createAstEditTool(workspace, session, onOutput),
    editFile: createEditFileTool(workspace, session, onOutput),
    createFile: createCreateFileTool(workspace, session, onOutput),
    deleteFile: createDeleteFileTool(workspace, session, onOutput),
  };
}
