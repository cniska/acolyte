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
      "For explicit multi-file edit tasks, work one named file at a time from the start: do not batch the initial `read-file` across named targets. Read the file you are about to change, edit it, then move to the next named file.",
      "If an explicit target file read fails with ENOENT, stop and report the missing path unless the user asked for alternative files.",
      "For explicit file-scoped tasks, do not inspect neighboring files for examples or style unless the target files are insufficient.",
      "Once explicit file scope is established, do not use repo-wide `search-files` to look for the same pattern elsewhere unless the user asked for a broader update.",
      "When the user already named the files to change, do not use `git-status` or `git-diff` just to rediscover or reconfirm those same target files.",
      "Read the target file once, then edit. Do not re-read the same file after a successful edit.",
      "Before the first write, avoid repeated `read-file` calls on the same path unless the previous edit failed.",
      "For small in-file updates, use the exact line already visible in `read-file` output as your edit anchor instead of searching for it again.",
      "For rename/refactor tasks or repeated pattern updates, prefer `scan-code` + `edit-code` over `edit-file`.",
      "Batch multiple edits to the same file into one `edit-file` or `edit-code` call.",
      "If the needed text is already visible in `read-file` output, do not call `search-files` just to locate it again.",
      "Trust type signatures; do not add impossible null/undefined guards unless the declared types allow them.",
      "Never delete a file to recreate it — use `edit-file` to modify existing files.",
      "When a target file does not exist, say so instead of silently creating it.",
      "After the last tool call, reply with one sentence summarizing the change. Nothing else.",
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
