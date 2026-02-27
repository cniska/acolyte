export type AgentMode = "plan" | "work" | "verify";

export type AgentModeDefinition = {
  tools: string[];
  preamble: string[];
  statusText: string;
};

export const agentModes: Record<AgentMode, AgentModeDefinition> = {
  plan: {
    tools: [
      "find-files",
      "search-files",
      "scan-code",
      "read-file",
      "git-status",
      "git-diff",
      "web-search",
      "web-fetch",
    ],
    preamble: [
      "Before the first tool call, briefly explain what you're about to do.",
      "Batch multiple reads into one `read-file` call when possible.",
      "End with a brief summary.",
    ],
    statusText: "Thinking…",
  },
  work: {
    tools: ["edit-code", "edit-file", "create-file", "delete-file", "run-command"],
    preamble: [
      "Before the first tool call, briefly explain what you're about to do.",
      "Read the target file before editing.",
      "Batch multiple edits to the same file into one `edit-file` or `edit-code` call.",
      "After a successful edit, do not re-read the same file unless explicitly asked.",
      "Never claim a file was edited unless confirmed by tool results.",
      "When a target file does not exist, say so instead of silently creating it.",
      "After the last tool call, reply with one sentence summarizing the change. Nothing else.",
    ],
    statusText: "Working…",
  },
  verify: {
    tools: ["run-command", "read-file", "search-files", "scan-code", "edit-code", "edit-file", "create-file"],
    preamble: [
      "Run the project's verify command (e.g. `bun run verify`).",
      "If verification fails, read the errors, fix the issues, and re-run.",
      "Keep fixing until verification passes or you are stuck.",
      "Run silently — only respond if verification fails and you cannot fix it.",
    ],
    statusText: "Verifying…",
  },
};

const CODE_WORDS =
  /\b(edit|rename|refactor|fix|create|implement|add|delete|remove|update|write|run|verify|change|move|replace|extract|inline|wrap)\b/i;
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
