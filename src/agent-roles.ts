import type { ChatRequest } from "./api";

export type AgentRole = "planner" | "coder" | "reviewer";

function isReviewRequest(text: string): boolean {
  return /\breview\b/i.test(text);
}

function isPlanningRequest(text: string): boolean {
  const lower = text.toLowerCase();
  const hints = ["plan", "roadmap", "strategy", "approach", "break down", "steps", "outline", "design"];
  return hints.some((hint) => lower.includes(hint));
}

function isCodingRequest(text: string): boolean {
  const lower = text.toLowerCase();
  const hints = ["implement", "fix", "write", "edit", "refactor", "add", "build", "create", "test"];
  return hints.some((hint) => lower.includes(hint));
}

const DEFAULT_ROLE_SOUL: Record<AgentRole, string> = {
  planner: "Role: planner. Produce concise, sequenced plans with risks and validation checkpoints.",
  coder:
    "Role: coder. Focus on practical implementation and compact, execution-oriented responses. Prefer one clear next action; avoid recap/capability sections and avoid lettered choice menus unless explicitly requested.",
  reviewer: "Role: reviewer. Prioritize concrete findings with evidence and concise remediation guidance.",
};

export function selectAgentRole(text: string): AgentRole {
  if (isReviewRequest(text)) {
    return "reviewer";
  }
  if (isPlanningRequest(text)) {
    return "planner";
  }
  if (isCodingRequest(text)) {
    return "coder";
  }
  return "coder";
}

export function buildSubagentContext(role: AgentRole, req: ChatRequest): string {
  const scope = req.history.length > 0 ? `${req.history.length} history messages` : "no history";
  const roleName = role[0].toUpperCase() + role.slice(1);
  const roleExpectations: Record<AgentRole, string> = {
    planner:
      "Expected output: concise sequenced plan with risks and validation checkpoints; avoid recap/status scaffolding and use numbered options only when explicitly requested.",
    coder:
      "Expected output: practical implementation guidance; use tools when needed and keep results compact; prefer one clear recommendation over option menus; avoid recap/status/capability sections.",
    reviewer:
      "Expected output: prioritized findings with concrete evidence and remediation guidance; avoid recap/status scaffolding and default to direct findings.",
  };
  const lines = [
    `Subagent: ${roleName}`,
    `Goal: ${req.message.trim()}`,
    `Context: ${scope}; model=${req.model}`,
    roleExpectations[role],
  ];
  return lines.join("\n");
}

export function buildRoleInstructions(baseInstructions: string, role: AgentRole, roleSoul?: string): string {
  const overlay = roleSoul?.trim() || DEFAULT_ROLE_SOUL[role];
  return [baseInstructions, overlay].join("\n\n");
}
