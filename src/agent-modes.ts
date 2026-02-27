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
      "Reply with a concise summary. No preamble, no narration of your process.",
    ],
    statusText: "Thinking…",
  },
  work: {
    tools: ["read-file", "edit-code", "edit-file", "create-file", "delete-file", "run-command"],
    preamble: [
      "Read the target file once, then edit. Do not re-read the same file after a successful edit.",
      "Batch multiple edits to the same file into one `edit-file` or `edit-code` call.",
      "Never delete a file to recreate it — use `edit-file` to modify existing files.",
      "When a target file does not exist, say so instead of silently creating it.",
      "After the last tool call, reply with one sentence summarizing the change. Nothing else.",
    ],
    statusText: "Working…",
  },
  verify: {
    tools: ["run-command", "read-file", "search-files", "edit-code", "edit-file", "create-file"],
    preamble: [
      "Run the project's verify command (e.g. `bun run verify`).",
      "If verification fails, read the errors, fix the issues, and re-run.",
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
    if (def.tools.includes(toolName)) {
      return mode as AgentMode;
    }
  }
  return "work";
}
