import type { AgentMode } from "./agent-contract";
import { t } from "./i18n";
import type { ToolPermission } from "./tool-contract";
import { toolIdsForGrants } from "./tool-registry";

export type AgentModeDefinition = {
  grants: readonly ToolPermission[];
  tools: string[];
  preamble: string[];
  statusText: string;
};

export const agentModes: Record<AgentMode, AgentModeDefinition> = {
  work: {
    grants: ["read", "write", "execute", "network"],
    tools: toolIdsForGrants(["read", "write", "execute", "network"]),
    preamble: [
      "If the target path is explicit, skip `find-files`/`search-files` and read that file directly.",
      "For 'add/update in file X' tasks, make `read-file` on X your first tool call.",
      "If the user names the files to change, limit reads and edits to those files plus directly referenced support files needed to complete the task.",
      "For explicit multi-file edit tasks, work one named file at a time: read the file you are about to change, edit it, then move to the next.",
      "If an explicit target file read fails with ENOENT, stop and report the missing path unless the user asked for alternative files.",
      "For explicit file-scoped tasks, stay inside the named files unless they are insufficient.",
      "For small in-file updates, use the exact line already visible in `read-file` output as your edit anchor instead of searching for it again.",
      "For existing link or path fixes, preserve the relative or absolute form already used in that file instead of rewriting it to a new global style.",
      "For small fixes in an existing file, use exact `find`/`replace` edits and keep the change as small as the request allows.",
      "For repeated literal replacements in one known file, do not use `search-files`, `scan-code`, or extra rereads after the initial direct read. Make one consolidated `edit-file` call.",
      "For explicit bounded fixes, make the requested change and stop.",
      "For small named-file tasks, trust the edit preview and the text you already have.",
      "For rename/refactor tasks or repeated structural code updates, prefer `scan-code` + `edit-code` over `edit-file`.",
      "If the task is a repeated plain-text rewrite inside one known file, prefer one consolidated `edit-file` call over `edit-code`.",
      "Batch multiple edits to the same file into one `edit-file` or `edit-code` call.",
      "Trust type signatures; do not add impossible null/undefined guards unless the declared types allow them.",
      "Never delete a file to recreate it — use `edit-file` to modify existing files.",
      "When a target file does not exist, say so instead of silently creating it.",
      "After the last tool call, use the lifecycle signal format from the base instructions and keep the user-facing outcome to one sentence.",
    ],
    statusText: t("agent.status.working"),
  },
  verify: {
    grants: ["read", "execute"],
    tools: toolIdsForGrants(["read", "execute"]),
    preamble: [
      "Review the changes: one `scan-code` call with all edited files as `paths` and patterns like [`export function $NAME`, `import $SPEC from $MOD`]. No extra reads or searches.",
      "Choose the lightest sufficient verification for the actual change. For narrow documentation or content-only edits, scan the changed files and stop unless the user explicitly asked for project-wide verification.",
      "Otherwise run the project's verify/test/build command if one exists. If it fails with 'script not found', stop — your scan-code review is sufficient.",
      "Report any issues found. Do not fix them — work mode will handle fixes.",
      "Do not narrate — only respond if you found issues.",
    ],
    statusText: t("agent.status.verifying"),
  },
};
