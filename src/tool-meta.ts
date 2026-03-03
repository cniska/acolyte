import { gitToolMeta } from "./git-toolkit";
import type { ToolName } from "./tool-names";

export type ToolMeta = {
  instruction: string;
  aliases: readonly string[];
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
  ...gitToolMeta,
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
