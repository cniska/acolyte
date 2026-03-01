import { resolve } from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { appConfig } from "./app-config";
import { countLabel } from "./plural";
import { createId } from "./short-id";
import { LIFECYCLE_ERROR_CODES } from "./tool-error-codes";
import { createSessionContext, recordCall, runGuards, type SessionContext } from "./tool-guards";
import type { ToolName } from "./tool-names";
import { compactToolOutput } from "./tool-output";
import {
  emitFileListSummary,
  emitFindSummary,
  emitResultChunks,
  emitSearchSummary,
  findResultPaths,
  numberedUnifiedDiffLines,
  searchResultSummaryEntries,
  TOOL_OUTPUT_FILES_MAX_ROWS,
  TOOL_OUTPUT_MARKERS,
  TOOL_OUTPUT_RUN_MAX_ROWS,
} from "./tool-output-format";
import {
  deleteTextFile,
  editCode,
  editFile,
  fetchWeb,
  findFiles,
  gitDiff,
  gitLog,
  gitShow,
  gitStatusShort,
  readSnippets,
  runShellCommand,
  scanCode,
  searchFiles,
  searchWeb,
  writeTextFile,
} from "./tools";

// --- Tool metadata ---

type ToolOutputListener = (event: { toolName: ToolName; message: string; toolCallId?: string }) => void;
const WRITE_TOOL_PREVIEW_MAX_LINES = 30;
const WEB_SEARCH_MAX_RESULTS = 5;

export type ToolMeta = {
  instruction: string;
  aliases: string[];
};

export const toolMeta: Record<ToolName, ToolMeta> = {
  "find-files": {
    instruction:
      "Use `find-files` to locate files by name or path pattern. Always pass `patterns` as an array (e.g. [`api.ts`, `store.ts`]).",
    aliases: ["findFiles", "find_files"],
  },
  "search-files": {
    instruction:
      "Use `search-files` to search file contents by text or regex. Always batch related queries via `patterns`; optionally scope with `paths`.",
    aliases: ["searchFiles", "search_files", "searchRepo", "search_repo"],
  },
  "read-file": {
    instruction:
      "Use `read-file` to inspect code before editing. Pass `paths` as an array; batch multiple reads into one call.",
    aliases: ["readFile", "read_file"],
  },
  "git-status": {
    instruction: "Use `git-status` for working tree status.",
    aliases: ["gitStatus", "git_status"],
  },
  "git-diff": {
    instruction: "Use `git-diff` for change inspection.",
    aliases: ["gitDiff", "git_diff"],
  },
  "git-log": {
    instruction: "Use `git-log` to inspect recent commits quickly (optionally scoped by path).",
    aliases: ["gitLog", "git_log"],
  },
  "git-show": {
    instruction: "Use `git-show` to inspect a specific commit/tag/ref with patch details (optionally scoped by path).",
    aliases: ["gitShow", "git_show"],
  },
  "web-search": {
    instruction: "Use `web-search` for external information lookup.",
    aliases: ["webSearch", "web_search"],
  },
  "web-fetch": {
    instruction: "Use `web-fetch` to read web pages, docs, or API references.",
    aliases: ["webFetch", "web_fetch"],
  },
  "scan-code": {
    instruction:
      "Use `scan-code` for AST pattern matching. Always pass `paths` and `patterns` as arrays. Batch multiple files and patterns in one call (e.g. paths=[`src/a.ts`, `src/b.ts`], patterns=[`export function $NAME`, `import $SPEC from $MOD`]). Metavariable names (`$NAME`, `$ARG`) are wildcards — they match any node, not literal text. Use it to map rename/refactor targets before `edit-code`. For keyword or regex searches prefer `search-files`.",
    aliases: ["scanCode", "scan_code"],
  },
  "edit-code": {
    instruction:
      "Use `edit-code` for multi-location code changes, rename/refactor updates, or structural rewrites with AST `edits` array. `path` must be a concrete file path (not `.` or a directory). Prefer `edit-file` for single-location text edits.",
    aliases: ["editCode", "edit_code"],
  },
  "edit-file": {
    instruction:
      "Use `edit-file` for text edits. For small changes use {find, replace} pairs where `find` is exact text to locate. For larger block changes use {startLine, endLine, replace} with 1-based line numbers from `read-file`. `replace` is *only* the new text for that region — do not include surrounding lines. Batch multiple edits to the same file into one call. If `find` is likely to match multiple locations, switch to `edit-code`.",
    aliases: ["editFile", "edit_file"],
  },
  "create-file": {
    instruction: "For new files, call `create-file` with full content directly.",
    aliases: ["createFile", "create_file", "writeFile", "write_file"],
  },
  "delete-file": {
    instruction:
      "Use `delete-file` to remove files from the repository. Pass `paths` as an array and batch related deletes in one call.",
    aliases: ["deleteFile", "delete_file"],
  },
  "run-command": {
    instruction:
      "Use `run-command` to run verification after edits and to execute build/test commands. Do not use it for file read/search/edit fallbacks (`cat`, `head`, `tail`, `nl`, `ls`, `grep`, `sed`, `find`, `rg`, `wc`) — use `read-file`, `search-files`, `find-files`, `edit-file`, or `edit-code`.",
    aliases: ["runCommand", "run_command", "execute_command"],
  },
};

// --- Output helpers ---

function streamCallId(toolName: ToolName): string {
  return `${toolName}_${createId()}`;
}

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
  onToolOutput: ToolOutputListener | undefined,
  toolCallId: string,
): void {
  const { files, added, removed } = diffTotals(rawResult);
  const touchedFiles = files > 0 ? files : 1;
  if (toolName === "create-file") {
    onToolOutput?.({
      toolName,
      message: `path=${path} files=${touchedFiles}`,
      toolCallId,
    });
    return;
  }
  onToolOutput?.({
    toolName,
    message: `path=${path} files=${touchedFiles} added=${added} removed=${removed}`,
    toolCallId,
  });
}

function createFilePreviewLine(line: string): string {
  const numberedDiff = line.match(/^(\d+)\s+[+-]\s(.*)$/);
  if (!numberedDiff) return line;
  const lineNumber = numberedDiff[1] ?? "";
  const text = numberedDiff[2] ?? "";
  return `${lineNumber}  ${text}`;
}

function emitHeadTailLines(
  toolName: ToolName,
  rawText: string,
  onToolOutput: ToolOutputListener | undefined,
  toolCallId: string,
  options?: { headRows?: number; tailRows?: number; trimStart?: boolean },
): void {
  if (!onToolOutput) return;
  const headRows = options?.headRows ?? 2;
  const tailRows = options?.tailRows ?? 2;
  const lines = rawText
    .split("\n")
    .map((line) => {
      const base = line.trimEnd();
      return options?.trimStart ? base.trimStart() : base;
    })
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    onToolOutput({ toolName, message: TOOL_OUTPUT_MARKERS.noOutput, toolCallId });
    return;
  }
  if (lines.length > headRows + tailRows) {
    const omitted = lines.length - (headRows + tailRows);
    const preview = [
      ...lines.slice(0, headRows),
      `${TOOL_OUTPUT_MARKERS.truncated} +${countLabel(omitted, "line", "lines")}`,
      ...lines.slice(lines.length - tailRows),
    ];
    for (const line of preview) onToolOutput({ toolName, message: line, toolCallId });
    return;
  }
  for (const line of lines) onToolOutput({ toolName, message: line, toolCallId });
}

function stripGitShowMetadataForPreview(rawText: string): string {
  let inPatch = false;
  return rawText
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("Author:") && !trimmed.startsWith("Date:");
    })
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("diff --git ")) inPatch = true;
      if (!inPatch && line.startsWith("    ")) return line.slice(4);
      return line;
    })
    .join("\n");
}

function encodeValue(value: string): string {
  return JSON.stringify(value);
}

function normalizeUniquePaths(paths: string[]): string[] {
  const normalized = paths.map((path) => path.trim()).filter((path) => path.length > 0);
  return Array.from(new Set(normalized));
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
    return [`query=${encodeValue(normalizeQuery(noResultsMatch[1]))} results=0`, TOOL_OUTPUT_MARKERS.noOutput].join(
      "\n",
    );
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
    out.push(
      `${TOOL_OUTPUT_MARKERS.truncated} +${countLabel(entries.length - WEB_SEARCH_MAX_RESULTS, "result", "results")}`,
    );
  if (entries.length === 0) out.push(TOOL_OUTPUT_MARKERS.noOutput);
  return out.join("\n");
}

// --- Guarded execution ---

function createRunCommandTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "run-command",
    description:
      "Run a shell command in the repository and capture stdout/stderr. Never use shell commands as fallbacks for file discovery/reading/editing when dedicated tools are available.",
    inputSchema: z.object({
      command: z.string().min(1),
      timeoutMs: z.number().int().min(500).max(120000).optional(),
    }),
    execute: async (input) => {
      return withToolError("run-command", () =>
        guardedExecute("run-command", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("run-command");
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
            const preview = [
              ...streamed.slice(0, headRows),
              `[truncated] +${countLabel(omitted, "line", "lines")}`,
              ...streamed.slice(streamed.length - tailRows),
            ];
            for (const line of preview) onToolOutput?.({ toolName: "run-command", message: line, toolCallId });
          } else if (streamed.length === 0) {
            onToolOutput?.({ toolName: "run-command", message: TOOL_OUTPUT_MARKERS.noOutput, toolCallId });
          } else {
            for (const line of streamed.slice(0, TOOL_OUTPUT_RUN_MAX_ROWS)) {
              onToolOutput?.({ toolName: "run-command", message: line, toolCallId });
            }
          }
          const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.run);
          return { result };
        }),
      );
    },
  });
}

export async function withToolError<T>(toolId: ToolName, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(`${toolId} failed: ${message}`) as Error & { code?: string };
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === "string" && code.length > 0) wrapped.code = code;
    }
    throw wrapped;
  }
}

async function guardedExecute<T>(
  toolId: ToolName,
  args: Record<string, unknown>,
  session: SessionContext,
  task: () => Promise<T>,
): Promise<T> {
  try {
    runGuards({ toolName: toolId, args, session });
  } catch (error) {
    const wrapped = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Guard blocked");
    const coded = wrapped as Error & { code?: string };
    if (typeof coded.code !== "string" || coded.code.length === 0) coded.code = LIFECYCLE_ERROR_CODES.guardBlocked;
    throw coded;
  }
  try {
    const result = await task();
    return result;
  } finally {
    recordCall(session, toolId, args);
  }
}

// --- Tool factories ---

function createFindFilesTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "find-files",
    description:
      "Find files in the repository by name or path pattern. Pass `patterns` as an array to batch multiple lookups in one call. To search file contents use `search-files` instead.",
    inputSchema: z.object({
      patterns: z.array(z.string().min(1)).min(1),
      maxResults: z.number().int().min(1).max(200).optional(),
    }),
    execute: async (input) => {
      return withToolError("find-files", () =>
        guardedExecute("find-files", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("find-files");
          const maxResults = input.maxResults ?? 40;
          const count = input.patterns.length;
          const baseBudget = appConfig.agent.toolOutputBudget.findFiles;
          const budget = {
            maxChars: Math.max(400, Math.floor(baseBudget.maxChars / count) * count),
            maxLines: Math.max(20, Math.floor(baseBudget.maxLines / count) * count),
          };
          const result = compactToolOutput(await findFiles(workspace, input.patterns, maxResults), budget);
          const paths = findResultPaths(result);
          emitFindSummary(paths, input.patterns, onToolOutput, toolCallId, TOOL_OUTPUT_FILES_MAX_ROWS, workspace);
          return { result };
        }),
      );
    },
  });
}

function createSearchFilesTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "search-files",
    description:
      "Search file contents in the repository for text or regex patterns. Optionally scope with `paths` (files or directories). To locate files by name use `find-files` instead.",
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
            onToolOutput,
            toolCallId,
            TOOL_OUTPUT_FILES_MAX_ROWS,
            workspace,
          );
          return { result };
        }),
      );
    },
  });
}

function createScanCodeTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "scan-code",
    description:
      "Scan files for structural code patterns using AST matching. Pass `paths` as an array of file or directory paths and `patterns` as an array of ast-grep patterns with `$VAR` metavariables (e.g. [`export function $NAME($$$PARAMS)`, `import $SPEC from $MOD`]).",
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
          const paths = normalizeUniquePaths(input.paths);
          emitFileListSummary("scan-code", paths, onToolOutput, toolCallId, TOOL_OUTPUT_FILES_MAX_ROWS, workspace);
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
          return { result };
        }),
      );
    },
  });
}

function createReadFileTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "read-file",
    description:
      "Read one or more text file snippets by line range. Always pass `paths` as an array of {path, start?, end?} objects, even for a single file. Use to inspect code before editing.",
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
          const entries = normalizeReadEntries(input.paths);
          if (entries.length === 0) throw new Error("Read requires at least one non-empty path");
          emitFileListSummary(
            "read-file",
            entries.map((entry) => entry.path),
            onToolOutput,
            toolCallId,
            TOOL_OUTPUT_FILES_MAX_ROWS,
            workspace,
          );
          const baseBudget = appConfig.agent.toolOutputBudget.read;
          const count = entries.length;
          const budget = {
            maxChars: Math.max(400, Math.floor(baseBudget.maxChars / count) * count),
            maxLines: Math.max(20, Math.floor(baseBudget.maxLines / count) * count),
          };
          const result = compactToolOutput(await readSnippets(workspace, entries), budget);
          return { result };
        }),
      );
    },
  });
}

function createGitStatusTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "git-status",
    description: "Show working tree status (short format with branch) for the current repository.",
    inputSchema: z.object({}),
    execute: async () => {
      return withToolError("git-status", () =>
        guardedExecute("git-status", {}, session, async () => {
          const toolCallId = streamCallId("git-status");
          const rawStatus = await gitStatusShort(workspace);
          emitHeadTailLines("git-status", rawStatus, onToolOutput, toolCallId, { trimStart: true });
          const result = compactToolOutput(rawStatus, appConfig.agent.toolOutputBudget.gitStatus);
          return { result };
        }),
      );
    },
  });
}

function createGitDiffTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "git-diff",
    description: "Show unstaged changes (unified diff) for the repository or a specific file path.",
    inputSchema: z.object({
      path: z.string().optional(),
      contextLines: z.number().int().min(0).max(20).optional(),
    }),
    execute: async (input) => {
      return withToolError("git-diff", () =>
        guardedExecute("git-diff", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("git-diff");
          const rawDiff = await gitDiff(workspace, input.path, input.contextLines ?? 3);
          emitHeadTailLines("git-diff", rawDiff, onToolOutput, toolCallId, { headRows: 4, tailRows: 4 });
          const result = compactToolOutput(rawDiff, appConfig.agent.toolOutputBudget.gitDiff);
          return { result };
        }),
      );
    },
  });
}

function createGitLogTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "git-log",
    description: "Show recent commits in compact one-line form (optionally scoped to a file/path).",
    inputSchema: z.object({
      path: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    execute: async (input) => {
      return withToolError("git-log", () =>
        guardedExecute("git-log", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("git-log");
          const rawLog = await gitLog(workspace, { path: input.path, limit: input.limit });
          emitHeadTailLines("git-log", rawLog, onToolOutput, toolCallId, { trimStart: true });
          const result = compactToolOutput(rawLog, appConfig.agent.toolOutputBudget.gitStatus);
          return { result };
        }),
      );
    },
  });
}

function createGitShowTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "git-show",
    description: "Show commit details and patch for a ref (default HEAD), optionally scoped to a path.",
    inputSchema: z.object({
      ref: z.string().optional(),
      path: z.string().optional(),
      contextLines: z.number().int().min(0).max(20).optional(),
    }),
    execute: async (input) => {
      return withToolError("git-show", () =>
        guardedExecute("git-show", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("git-show");
          const rawShow = await gitShow(workspace, {
            ref: input.ref,
            path: input.path,
            contextLines: input.contextLines ?? 3,
          });
          emitHeadTailLines("git-show", stripGitShowMetadataForPreview(rawShow), onToolOutput, toolCallId, {
            headRows: 4,
            tailRows: 4,
          });
          const result = compactToolOutput(rawShow, appConfig.agent.toolOutputBudget.gitDiff);
          return { result };
        }),
      );
    },
  });
}

function createEditFileTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "edit-file",
    description:
      "Edit an existing file. Pass `edits` as an array of either {find, replace} pairs (for small surgical edits using exact text match) or {startLine, endLine, replace} objects (for larger block replacements). Line numbers MUST come from `read-file` output — do not guess. endLine must not exceed the file length. All edits are applied atomically. You MUST read the file first. For new files, use `create-file`. For code renames or structural edits use `edit-code`.",
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
          const rawResult = await editFile({
            workspace,
            path: input.path,
            edits: input.edits,
          });
          emitDiffSummaryHeader("edit-file", input.path, rawResult, onToolOutput, toolCallId);
          for (const line of numberedUnifiedDiffLines(rawResult, WRITE_TOOL_PREVIEW_MAX_LINES)) {
            onToolOutput?.({ toolName: "edit-file", message: line, toolCallId });
          }
          const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.edit);
          return { result };
        }),
      );
    },
  });
}

function createCreateFileTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "create-file",
    description:
      "Create a new file with full content. For editing existing files, use `edit-file` or `edit-code` instead.",
    inputSchema: z.object({
      path: z.string().min(1),
      content: z.string(),
    }),
    execute: async (input) => {
      return withToolError("create-file", () =>
        guardedExecute("create-file", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("create-file");
          const rawResult = await writeTextFile({
            workspace,
            path: input.path,
            content: input.content,
            overwrite: true,
          });
          emitDiffSummaryHeader("create-file", input.path, rawResult, onToolOutput, toolCallId);
          for (const line of numberedUnifiedDiffLines(rawResult, WRITE_TOOL_PREVIEW_MAX_LINES)) {
            onToolOutput?.({ toolName: "create-file", message: createFilePreviewLine(line), toolCallId });
          }
          const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.create);
          return { result };
        }),
      );
    },
  });
}

function createAstEditTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "edit-code",
    description:
      "Edit code with AST pattern matching. Pass `edits` as [{pattern, replacement}] using `$VAR` metavariables (e.g. pattern=`console.log($ARG)` replacement=`logger.debug($ARG)`). `path` must be a specific file, not '.' or a directory. For non-code files use `edit-file`.",
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
          const rawResult = await editCode({
            workspace,
            path: input.path,
            edits: input.edits,
          });
          emitDiffSummaryHeader("edit-code", input.path, rawResult, onToolOutput, toolCallId);
          for (const line of numberedUnifiedDiffLines(rawResult, WRITE_TOOL_PREVIEW_MAX_LINES)) {
            onToolOutput?.({ toolName: "edit-code", message: line, toolCallId });
          }
          const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.astEdit);
          return { result };
        }),
      );
    },
  });
}

function createDeleteFileTool(workspace: string, session: SessionContext) {
  return createTool({
    id: "delete-file",
    description: "Delete a file from the repository.",
    inputSchema: z.object({
      paths: z.array(z.string().min(1)).min(1),
    }),
    execute: async (input) => {
      return withToolError("delete-file", () =>
        guardedExecute("delete-file", input as Record<string, unknown>, session, async () => {
          const paths = normalizeUniquePaths(input.paths);
          const resultParts: string[] = [];
          for (const path of paths) {
            const rawResult = await deleteTextFile({ workspace, path });
            resultParts.push(rawResult);
          }
          const rawResult = resultParts.join("\n\n");
          const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.edit);
          return { result };
        }),
      );
    },
  });
}

function createWebSearchTool(session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "web-search",
    description:
      "Search the public web for recent information and return top results. Use for questions not answerable from the repo.",
    inputSchema: z.object({
      query: z.string().min(1),
      maxResults: z.number().int().min(1).max(10).optional(),
    }),
    execute: async (input) => {
      return withToolError("web-search", () =>
        guardedExecute("web-search", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("web-search");
          const result = compactToolOutput(
            await searchWeb(input.query, input.maxResults ?? 5),
            appConfig.agent.toolOutputBudget.webSearch,
          );
          emitResultChunks("web-search", webSearchStreamRows(result), onToolOutput, 80, toolCallId);
          return { result };
        }),
      );
    },
  });
}

function createWebFetchTool(session: SessionContext) {
  return createTool({
    id: "web-fetch",
    description:
      "Fetch a public URL and return extracted text content. Use to read docs, API references, or linked resources by URL.",
    inputSchema: z.object({
      url: z.string().min(1),
      maxChars: z.number().int().min(500).max(12000).optional(),
    }),
    execute: async (input) => {
      return withToolError("web-fetch", () =>
        guardedExecute("web-fetch", input as Record<string, unknown>, session, async () => {
          const result = compactToolOutput(
            await fetchWeb(input.url, input.maxChars ?? 5000),
            appConfig.agent.toolOutputBudget.webFetch,
          );
          return { result };
        }),
      );
    },
  });
}

// --- Toolset assembly ---

export type AcolyteToolset = ReturnType<typeof createToolset>["tools"];

function createToolset(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return {
    tools: {
      findFiles: createFindFilesTool(workspace, session, onToolOutput),
      searchFiles: createSearchFilesTool(workspace, session, onToolOutput),
      scanCode: createScanCodeTool(workspace, session, onToolOutput),
      readFile: createReadFileTool(workspace, session, onToolOutput),
      gitStatus: createGitStatusTool(workspace, session, onToolOutput),
      gitDiff: createGitDiffTool(workspace, session, onToolOutput),
      gitLog: createGitLogTool(workspace, session, onToolOutput),
      gitShow: createGitShowTool(workspace, session, onToolOutput),
      runCommand: createRunCommandTool(workspace, session, onToolOutput),
      editCode: createAstEditTool(workspace, session, onToolOutput),
      editFile: createEditFileTool(workspace, session, onToolOutput),
      createFile: createCreateFileTool(workspace, session, onToolOutput),
      deleteFile: createDeleteFileTool(workspace, session),
      webSearch: createWebSearchTool(session, onToolOutput),
      webFetch: createWebFetchTool(session),
    },
    session,
  };
}

function readOnlyTools(
  workspace: string,
  session: SessionContext,
  onToolOutput?: ToolOutputListener,
): { tools: Partial<AcolyteToolset>; session: SessionContext } {
  return {
    tools: {
      findFiles: createFindFilesTool(workspace, session, onToolOutput),
      searchFiles: createSearchFilesTool(workspace, session, onToolOutput),
      scanCode: createScanCodeTool(workspace, session, onToolOutput),
      readFile: createReadFileTool(workspace, session, onToolOutput),
      gitStatus: createGitStatusTool(workspace, session, onToolOutput),
      gitDiff: createGitDiffTool(workspace, session, onToolOutput),
      gitLog: createGitLogTool(workspace, session, onToolOutput),
      gitShow: createGitShowTool(workspace, session, onToolOutput),
      webSearch: createWebSearchTool(session, onToolOutput),
      webFetch: createWebFetchTool(session),
    },
    session,
  };
}

// --- Public API ---

export function toolsForAgent(options?: { workspace?: string; onToolOutput?: ToolOutputListener; taskId?: string }): {
  tools: Partial<AcolyteToolset>;
  session: SessionContext;
} {
  const workspace = options?.workspace ?? resolve(process.cwd());
  const session = createSessionContext(options?.taskId);
  if (appConfig.agent.permissions.mode === "read") return readOnlyTools(workspace, session, options?.onToolOutput);
  return createToolset(workspace, session, options?.onToolOutput);
}
