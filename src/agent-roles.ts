import type { ChatRequest } from "./api";

export type AgentRole = "planner" | "coder" | "reviewer";

function isReviewRequest(text: string): boolean {
  return /\breview\b/i.test(text);
}

function isPlanningRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  const patterns = [
    /\bplan(?:ning)?\b/,
    /\broadmap\b/,
    /\bstrategy\b/,
    /\bapproach\b/,
    /\bbreak down\b/,
    /\bsteps?\b/,
    /\boutline\b/,
    /\bdesign\b/,
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function isCodingRequest(text: string): boolean {
  const lower = text.toLowerCase();
  const hints = ["implement", "fix", "write", "edit", "refactor", "add", "build", "create", "test"];
  return hints.some((hint) => lower.includes(hint));
}

function isDirectEditIntent(text: string): boolean {
  return /\b(add|change|update|remove|delete|edit|fix|insert|write)\b/i.test(text);
}

const DEFAULT_ROLE_SOUL: Record<AgentRole, string> = {
  planner: "Role: planner. Produce concise, sequenced plans with risks and validation checkpoints.",
  coder:
    "Role: coder. Focus on practical execution guidance and compact, execution-oriented responses. Prefer one clear next action; avoid recap/capability sections and avoid lettered choice menus unless explicitly requested. Do not end with confirmation questions unless a risky/destructive step truly needs approval. For edit/fix/add requests, execute tools and make the change instead of returning a plan-only response. Before edit-file changes, read the target file snippet and use exact text for replacements. If a change cannot be applied, return a concrete reason and the smallest next action to unblock. For repo-specific questions, use relevant tools before answering. Do not edit tests unless the user explicitly asks for test changes or a regression fix clearly requires it.",
  reviewer: "Role: reviewer. Prioritize concrete findings with evidence and concise remediation guidance.",
};

export function selectAgentRole(text: string): AgentRole {
  if (isReviewRequest(text)) {
    return "reviewer";
  }
  if (isDirectEditIntent(text)) {
    return "coder";
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
      "Expected output: practical execution guidance; use tools when needed and keep results compact; prefer one clear recommendation over option menus; avoid recap/status/capability sections; avoid confirmation questions unless a risky/destructive step needs approval; for edit/fix/add requests, execute tools and apply changes instead of plan-only replies; read target snippets first so replacements use exact text; when edits fail, return concrete cause plus smallest unblock step; for repo-specific prompts, use relevant tools before answering; avoid test edits unless explicitly requested or required for meaningful regression coverage.",
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
