export type AgentMode = "explore" | "code" | "ask";

export type AgentModeDefinition = {
  tools: string[];
  progressText: string;
};

export const agentModes: Record<AgentMode, AgentModeDefinition> = {
  explore: {
    tools: ["find-files", "search-files", "read-file", "git-status", "git-diff", "web-search", "web-fetch"],
    progressText: "Exploring…",
  },
  code: {
    tools: ["edit-file", "create-file", "edit-code", "delete-file", "run-command"],
    progressText: "Coding…",
  },
  ask: {
    tools: [],
    progressText: "Thinking…",
  },
};

export function modeForTool(toolName: string): AgentMode {
  for (const [mode, def] of Object.entries(agentModes)) {
    if (def.tools.includes(toolName)) {
      return mode as AgentMode;
    }
  }
  return "ask";
}
