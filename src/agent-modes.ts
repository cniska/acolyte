import type { AgentMode } from "./agent-contract";
import type { ToolPermission } from "./tool-contract";
import { toolIdsForGrants } from "./tool-registry";

export type AgentModeDefinition = {
  grants: readonly ToolPermission[];
  tools: string[];
  preamble: string[];
  statusText: string;
};

export const agentModes: Record<AgentMode, AgentModeDefinition> = {
  plan: {
    grants: ["read", "network"],
    tools: toolIdsForGrants(["read", "network"]),
    preamble: [
      "Search first, then read relevant files. Batch multiple paths into one `read-file` call.",
      "Stop as soon as you have enough information — do not keep searching for completeness.",
      "For negative-answer tasks, stop after decisive evidence; do not run synonym searches once the answer is clear.",
      "Reply with a concise summary. No preamble, no narration of your process.",
    ],
    statusText: "Thinking…",
  },
  work: {
    grants: ["read", "write", "execute", "network"],
    tools: toolIdsForGrants(["read", "write", "execute", "network"]),
    preamble: [
      "If the target path is explicit, skip `find-files`/`search-files` and read that file directly.",
      "For 'add/update in file X' tasks, make `read-file` on X your first tool call.",
      "If an explicit target file read fails with ENOENT, stop and report the missing path unless the user asked for alternative files.",
      "Read the target file once, then edit. Do not re-read the same file after a successful edit.",
      "Before the first write, avoid repeated `read-file` calls on the same path unless the previous edit failed.",
      "For rename/refactor tasks or repeated pattern updates, prefer `scan-code` + `edit-code` over `edit-file`.",
      "Batch multiple edits to the same file into one `edit-file` or `edit-code` call.",
      "Trust type signatures; do not add impossible null/undefined guards unless the declared types allow them.",
      "Never delete a file to recreate it — use `edit-file` to modify existing files.",
      "When a target file does not exist, say so instead of silently creating it.",
      "After the last tool call, reply with one sentence summarizing the change. Nothing else.",
    ],
    statusText: "Working…",
  },
  verify: {
    grants: ["read", "execute"],
    tools: toolIdsForGrants(["read", "execute"]),
    preamble: [
      "Review the changes: one `scan-code` call with all edited files as `paths` and patterns like [`export function $NAME`, `import $SPEC from $MOD`]. No extra reads or searches.",
      "Then run the project's verify/test/build command if one exists. If it fails with 'script not found', stop — your scan-code review is sufficient.",
      "Report any issues found. Do not fix them — work mode will handle fixes.",
      "Do not narrate — only respond if you found issues.",
    ],
    statusText: "Verifying…",
  },
};

export function modeForTool(toolName: string): AgentMode {
  for (const [mode, def] of Object.entries(agentModes)) {
    if (def.tools.includes(toolName)) return mode as AgentMode;
  }
  return "work";
}
