import type { AgentMode } from "./agent-contract";
import type { ToolPermission } from "./tool-contract";
import { toolIdsForGrants } from "./tool-registry";

export type AgentModeDefinition = {
  grants: readonly ToolPermission[];
  tools: string[];
  preamble: string[];
};

export const agentModes: Record<AgentMode, AgentModeDefinition> = {
  work: {
    grants: ["read", "write", "execute", "network"],
    tools: toolIdsForGrants(["read", "write", "execute", "network"]),
    preamble: [
      "If the target path is explicit, skip `file-find`/`file-search` and read that file directly.",
      "For 'add/update in file X' tasks, make `file-read` on X your first tool call.",
      "If the user names the files to change, limit reads and edits to those files plus directly referenced support files needed to complete the task.",
      "For explicit multi-file edit tasks, work one named file at a time: read the file you are about to change, edit it, then move to the next.",
      "For explicit named-file tasks, once every requested file has the requested bounded change, stop. Do not review, diff, or run commands just to reassure yourself unless the user asked for verification.",
      "If an explicit target file read fails with ENOENT, stop and report the missing path unless the user asked for alternative files.",
      "For explicit file-scoped tasks, stay inside the named files unless they are insufficient.",
      "For small in-file updates, use the exact line already visible in `file-read` output as your edit anchor instead of searching for it again.",
      "Every `file-edit` find snippet must come directly from the current `file-read` output or scoped `file-search` hits for that file. Do not invent intermediate lines or locals that are not in the evidence you have.",
      "For existing link or path fixes, preserve the relative or absolute form already used in that file instead of rewriting it to a new global style.",
      "For small fixes in an existing file, use exact `find`/`replace` edits and keep the change as small as the request allows.",
      "For repeated literal replacements in one known file, do not use `file-search`, `code-scan`, or extra rereads after the initial direct read. Use that read to collect every visible requested occurrence and make one consolidated `file-edit` call.",
      "If the requested literal appears in multiple visible locations in the direct read of a named file, your `file-edit` call must cover all of those visible locations, not just the first contiguous block.",
      "For multi-file rename or repeated replacement tasks, if a named file has separated occurrences you have not yet pinned to exact snippets, run one scoped `file-search` on that file before editing instead of guessing a larger `find` block.",
      "For bounded 'each'/'every'/'all' replacements in one named file, do not signal completion after the first hit or first partial batch; finish only when the latest file text and edit preview show no remaining requested matches in that file.",
      "For explicit bounded fixes, make the requested change and stop.",
      "For small named-file tasks, trust the edit preview and the text you already have.",
      "When a bounded edit in a named file succeeds, do not review, find, search, or scan that same file again in work mode unless the user asked for verification or the edit failed.",
      "Do not call another write tool on the same named file after a successful bounded edit unless the visible preview still shows requested changes remaining in that file.",
      "For rename/refactor tasks or repeated structural code updates, prefer `code-scan` + `code-edit` over `file-edit`.",
      "For a bounded structural change inside one named helper, declaration, or block, prefer `code-edit` with `withinSymbol` naming that enclosing symbol over a file-wide AST rewrite.",
      "For scoped structural renames, treat `withinSymbol` as symbol-aware within that scope: update local/shorthand references for local renames, and keep member renames on the declared member plus `this.member` references.",
      'If a scoped rename is ambiguous because the same name exists as both a local and a member, pass `target: "local"` or `target: "member"` in the rename edit.',
      "If the user already names the enclosing helper or declaration for a scoped AST edit, do not search for that symbol first; read the file once and make one `code-edit` call with `withinSymbol`.",
      "If the task is a repeated plain-text rewrite inside one known file, prefer one consolidated `file-edit` call over `code-edit`.",
      "Batch multiple edits to the same file into one `file-edit` or `code-edit` call.",
      "Trust type signatures; do not add impossible null/undefined guards unless the declared types allow them.",
      "Never delete a file to recreate it — use `file-edit` to modify existing files.",
      "When a target file does not exist, say so instead of silently creating it.",
      "Do not run lint, format, or build commands — the lifecycle runs them automatically after your edits.",
      "After editing a source file that has a test file (e.g. `foo.test.ts` for `foo.ts`), run `test-run` with the test file to validate your changes. Do not skip this step. Never run the full test suite via `shell-run`.",
      "Do not signal done until the requested behavior is actually implemented. Updating help text, comments, or tests alone is not completing the task — the functional change must be in place.",
      "After the last tool call, use the lifecycle signal format from the base instructions and keep the user-facing outcome to one sentence.",
      "For multi-step tasks (3+ distinct steps), use `checklist-create` at the start to define a progress checklist. Use `checklist-update` to mark items as you complete each step.",
    ],
  },
  verify: {
    grants: ["read", "execute"],
    tools: toolIdsForGrants(["read", "execute"]),
    preamble: [
      "Review the changes: one `code-scan` call with all edited files as `paths` and patterns like [`export function $NAME`, `import $SPEC from $MOD`]. No extra reads or searches.",
      "Choose the lightest sufficient verification for the actual change. For narrow documentation or content-only edits, scan the changed files and stop unless the user explicitly asked for project-wide verification.",
      "Do not run test or build commands in verify mode. Focus on reviewing the code changes.",
      "Report any issues found. Do not fix them — work mode will handle fixes.",
      "Do not narrate — only respond if you found issues.",
    ],
  },
};
