export type AgentMode = "plan" | "work" | "verify";

export type AgentModeDefinition = {
  tools: string[];
  preamble: string[];
  statusText: string;
};

export const agentModes: Record<AgentMode, AgentModeDefinition> = {
  plan: {
    tools: [
      "search-files",
      "read-file",
      "find-files",
      "scan-code",
      "git-status",
      "git-diff",
      "web-search",
      "web-fetch",
    ],
    preamble: [
      "Search first, then read relevant files. Batch multiple paths into one `read-file` call.",
      "Stop as soon as you have enough information — do not keep searching for completeness.",
      "For negative-answer tasks, stop after decisive evidence; do not run synonym searches once the answer is clear.",
      "Reply with a concise summary. No preamble, no narration of your process.",
    ],
    statusText: "Thinking…",
  },
  work: {
    tools: ["read-file", "scan-code", "edit-code", "edit-file", "create-file", "delete-file", "run-command"],
    preamble: [
      "If the target path is explicit, skip `find-files`/`search-files` and read that file directly.",
      "For 'add/update in file X' tasks, make `read-file` on X your first tool call.",
      "For actionable work requests, do not reply with a plan — your first assistant action should be a tool call.",
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
    tools: ["run-command", "read-file", "search-files", "edit-code", "edit-file", "create-file"],
    preamble: [
      "Run the project's verify command.",
      "If you need a non-verify command, confirm it exists in project tooling files before running it; do not guess names.",
      "If verification fails, read the errors, fix only files implicated by the errors, and re-run.",
      "Do not re-read files that were already read unless they changed or the error points to them.",
      "Keep fixing until verification passes or you are stuck.",
      "Do not narrate — only respond if verification fails and you cannot fix it.",
    ],
    statusText: "Verifying…",
  },
};

const CODE_WORDS =
  /\b(edit|rename|refactor|fix|create|implement|add|delete|remove|update|write|run|verify|change|move|replace|extract|inline|wrap|improve|convert|migrate|upgrade)\b/i;
const EXPLORE_WORDS =
  /\b(find|search|scan|read|look|show|list|what|where|how|explain|understand|check|inspect|describe)\b/i;

export function classifyMode(message: string): AgentMode {
  const hasCode = CODE_WORDS.test(message);
  const hasExplore = EXPLORE_WORDS.test(message);
  if (hasCode) return "work";
  if (hasExplore) return "plan";
  return "plan";
}

export function modeForTool(toolName: string): AgentMode {
  for (const [mode, def] of Object.entries(agentModes)) {
    if (def.tools.includes(toolName)) return mode as AgentMode;
  }
  return "work";
}
