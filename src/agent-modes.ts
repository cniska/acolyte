export type AgentMode = "explore" | "code" | "ask";

export type AgentModeDefinition = {
  tools: string[];
  instructions: string[];
  progressText: string;
};

export const agentModes: Record<AgentMode, AgentModeDefinition> = {
  explore: {
    tools: ["find-files", "search-files", "read-file", "git-status", "git-diff", "web-search", "web-fetch"],
    instructions: [
      "- Use `find-files` to locate files by name; use `search-files` to search file contents.",
      "- Use `git-status`/`git-diff` for change inspection.",
      "- Use `web-search`/`web-fetch` only when external lookup is needed.",
      "- Minimize round trips: one targeted read is preferred over multiple.",
    ],
    progressText: "Exploring…",
  },
  code: {
    tools: ["edit-file", "create-file", "edit-code", "delete-file", "run-command"],
    instructions: [
      "- Read the target file before editing.",
      "- For code changes (renames, refactors, structural edits), use `edit-code` with an AST pattern.",
      "- For prose, config, or non-code changes, use `edit-file` with a short unique `find` snippet.",
      "- For new files, call `create-file` with full content directly.",
      "- After a successful edit, do not re-read the same file unless explicitly asked.",
      "- Never claim a file was edited unless confirmed by tool results.",
      "- When a target file does not exist, say so instead of silently creating it.",
      "- Verify when explicitly requested or when risk is high.",
    ],
    progressText: "Coding…",
  },
  ask: {
    tools: [],
    instructions: ["- Answer concisely. Do not suggest tools or next steps unless asked."],
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
