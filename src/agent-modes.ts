export type AgentMode = "explore" | "code" | "ask";

export type AgentModeDefinition = {
  tools: string[];
  preamble: string[];
  progressText: string;
};

export const agentModes: Record<AgentMode, AgentModeDefinition> = {
  explore: {
    tools: ["find-files", "search-files", "read-file", "git-status", "git-diff", "web-search", "web-fetch"],
    preamble: ["Minimize round trips: one targeted read is preferred over multiple."],
    progressText: "Exploring…",
  },
  code: {
    tools: ["edit-code", "edit-file", "create-file", "delete-file", "run-command"],
    preamble: [
      "Read the target file before editing.",
      "After a successful edit, do not re-read the same file unless explicitly asked.",
      "Never claim a file was edited unless confirmed by tool results.",
      "When a target file does not exist, say so instead of silently creating it.",
    ],
    progressText: "Coding…",
  },
  ask: {
    tools: [],
    preamble: ["Answer concisely. Do not suggest tools or next steps unless asked."],
    progressText: "Thinking…",
  },
};

const CODE_WORDS =
  /\b(edit|rename|refactor|fix|create|implement|add|delete|remove|update|write|run|verify|change|move|replace|extract|inline|wrap)\b/i;
const EXPLORE_WORDS = /\b(find|search|read|look|show|list|what|where|how|explain|understand|check|inspect|describe)\b/i;

export function classifyMode(message: string): AgentMode {
  const hasCode = CODE_WORDS.test(message);
  const hasExplore = EXPLORE_WORDS.test(message);
  if (hasCode && !hasExplore) return "code";
  if (hasExplore && !hasCode) return "explore";
  if (hasCode && hasExplore) return "code";
  return "code";
}

export function modeForTool(toolName: string): AgentMode {
  for (const [mode, def] of Object.entries(agentModes)) {
    if (def.tools.includes(toolName)) {
      return mode as AgentMode;
    }
  }
  return "ask";
}
