import type { ChatRequest } from "./api";

export type AgentRole = "planner" | "coder" | "reviewer";

function isWhatNextPrompt(text: string): boolean {
  return /^(what('?s|\s+is)?\s+next)\??$/i.test(text.trim());
}

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
  coder: "Role: coder. Focus on practical implementation and compact, execution-oriented responses.",
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
    planner: "Expected output: concise sequenced plan with risks and validation checkpoints.",
    coder: "Expected output: practical implementation guidance; use tools when needed and keep results compact.",
    reviewer: "Expected output: prioritized findings with concrete evidence and remediation guidance.",
  };
  const lines = [
    `Subagent: ${roleName}`,
    `Goal: ${req.message.trim()}`,
    `Context: ${scope}; model=${req.model}`,
    roleExpectations[role],
  ];
  if (isWhatNextPrompt(req.message)) {
    lines.push("For this prompt, return exactly 3 concise numbered next steps (1. 2. 3.) and no lettered options.");
  }
  return lines.join("\n");
}

export function buildRoleInstructions(baseInstructions: string, role: AgentRole, roleSoul?: string): string {
  const overlay = roleSoul?.trim() || DEFAULT_ROLE_SOUL[role];
  return [baseInstructions, overlay].join("\n\n");
}
