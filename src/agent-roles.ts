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

function buildToolPolicy(baseInstructions: string): string {
  return [
    baseInstructions,
    "Tool policy:",
    "- For repository or codebase prompts, prefer tools over guessing.",
    "- Use search-repo to locate relevant files before answering.",
    "- Use read-file for exact evidence and quote paths/lines when relevant.",
    "- Use git-status/git-diff when asked about current changes.",
    "- Use run-command for verification commands when requested.",
    "- Use edit-file only when explicitly asked to modify files.",
    "Response style policy:",
    "- Keep tool-result responses compact and user-focused.",
    "- Do not start with conversational preambles like 'Done', 'Great', 'Sure', or similar.",
    "- Prefer a short status line plus at most 3 concise bullets when summarizing command results.",
    "- Do not add optional next-step menus unless the user asks for options.",
    "- Do not restate capabilities after normal command/task confirmations.",
    "Review response policy:",
    "- For review requests, prioritize concrete findings first (bugs/risks/regressions), ordered by severity.",
    "- Keep reviews concise: default to up to 3 high-signal findings unless the user asks for more.",
    "- If only 1-2 meaningful findings exist, return only those instead of padding.",
    "- Use this compact structure: first line `<N> findings in <scope>`, then numbered findings.",
    "- In `<scope>`, use plain file scope (for example `src/file.ts`), not `@src/file.ts`.",
    "- Number findings using `1.`, `2.`, `3.` style.",
    "- Do not indent numbered findings; each finding line must start directly with `1.`, `2.`, or `3.`.",
    "- Prefer this hybrid layout per finding (max 2 lines):",
    "  1) `1. <short title> (<severity>)`",
    "  2) `<path:line> — <evidence>; <recommendation>`",
    "- Keep wording compact and avoid long prose blocks.",
    "- Do not use verbose `Evidence:`/`Recommendation:` blocks unless explicitly requested.",
    "- Include file references in each finding when available (path:line).",
    "- Prefer single path:line references instead of broad line ranges when possible.",
    "- Do not add extra sections (summary, optional improvements, next steps, menus) unless explicitly requested.",
    "- Ground each finding in repo/file evidence and avoid generic process advice unless explicitly requested.",
    "- If evidence is incomplete, state that briefly instead of guessing broad recommendations.",
    "- Do not end with option-questions like 'which do you prefer?' unless the user explicitly asked for options.",
  ].join("\n");
}

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
  return [
    `Subagent: ${roleName}`,
    `Goal: ${req.message.trim()}`,
    `Context: ${scope}; model=${req.model}`,
    roleExpectations[role],
  ].join("\n");
}

export function buildRoleInstructions(baseInstructions: string, role: AgentRole): string {
  if (role === "planner") {
    return [
      baseInstructions,
      "Role: planner.",
      "- Focus on decomposition, sequencing, risks, and validation strategy.",
      "- Prefer concise actionable plans with clear milestones.",
      "- Avoid unnecessary tool usage unless repository evidence is explicitly needed.",
    ].join("\n");
  }

  if (role === "reviewer") {
    return [
      buildToolPolicy(baseInstructions),
      "Role: reviewer.",
      "- Prioritize concrete defects, regressions, and risks over stylistic nits.",
      "- Ground findings in files/evidence when possible.",
    ].join("\n");
  }

  return [
    buildToolPolicy(baseInstructions),
    "Role: coder.",
    "- Optimize for practical implementation and verification with available tools.",
    "- Keep responses compact and execution-oriented.",
  ].join("\n");
}
