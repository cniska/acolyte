import { renderActiveSkillBlock } from "./agent-instructions";
import type { ChatRequest } from "./api";
import { MAX_RECENT_TURNS } from "./lifecycle-constants";
import { log } from "./log";
import type { ActiveSkill } from "./skill-contract";
import { getLoadedSkills } from "./skill-ops";
import { estimateTokens } from "./token-estimate";

type WindowDrop = {
  droppedTurns: number;
  droppedTokens: number;
  tokensIdleAtDrop: number;
  keptHistoryTokens: number;
  missingTurns: number;
};

type PromptTokenBudget = {
  consume: (tokens: number) => void;
  remaining: () => number;
};

function createPromptTokenBudget(total: number): PromptTokenBudget {
  let remaining = Math.max(0, Math.floor(total));

  const clampRequest = (tokens: number): number => Math.max(0, Math.floor(tokens));

  const consume = (tokens: number): void => {
    const requested = clampRequest(tokens);
    if (requested === 0 || remaining === 0) return;
    remaining = Math.max(0, remaining - requested);
  };

  return {
    consume,
    remaining: () => remaining,
  };
}

function truncateByTokens(input: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  if (estimateTokens(input) <= maxTokens) return input;
  // Binary search for the longest prefix that fits within the token budget.
  let lo = 0;
  let hi = input.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (estimateTokens(input.slice(0, mid)) <= maxTokens - 1) lo = mid;
    else hi = mid - 1;
  }
  return `${input.slice(0, lo)}…`;
}

function isConversationalMessage(message: ChatRequest["history"][number]): boolean {
  if (message.role === "system") return false;
  if (message.kind === "status") return false;
  return true;
}

function recentTurns(
  messages: ChatRequest["history"],
  n: number,
): { kept: ChatRequest["history"]; dropped: ChatRequest["history"] } {
  const conversational = messages.filter(isConversationalMessage);
  let turns = 0;
  let cutIndex = 0;
  for (let i = conversational.length - 1; i >= 0; i--) {
    if (conversational[i].role === "user") {
      turns++;
      if (turns > n) return { kept: conversational.slice(cutIndex), dropped: conversational.slice(0, cutIndex) };
      cutIndex = i;
    }
  }
  return { kept: conversational, dropped: [] };
}

function isAssistantToolPayloadMessage(message: ChatRequest["history"][number]): boolean {
  return message.role === "assistant" && message.kind === "tool_payload";
}

function lineForMessage(message: ChatRequest["history"][number], maxTokens: number): { line: string; tokens: number } {
  const compact = truncateByTokens(message.content, maxTokens);
  const line = `${message.role.toUpperCase()}: ${compact}`;
  return { line, tokens: estimateTokens(line) };
}

function lineForMessageWithinBudget(
  message: ChatRequest["history"][number],
  remainingTokens: number,
): { line: string; tokens: number } | null {
  if (remainingTokens <= 0) return null;
  let tokenLimit = remainingTokens;
  while (tokenLimit > 0) {
    const candidate = lineForMessage(message, tokenLimit);
    if (candidate.tokens <= remainingTokens) return candidate;
    tokenLimit -= 1;
  }
  return null;
}

function collectLinesWithinBudget(
  messages: ChatRequest["history"],
  usedIds: Set<string>,
  remainingTokens: number,
): { lines: string[]; consumedTokens: number } {
  let consumed = 0;
  // Selected lines keyed by original index, so the budget-selection priority below
  // never dictates render order — the transcript must stay chronological.
  const selected = new Map<number, string>();
  const selectMessage = (i: number): void => {
    const message = messages[i];
    if (usedIds.has(message.id)) return;
    const candidate = lineForMessageWithinBudget(message, remainingTokens - consumed);
    if (!candidate || candidate.tokens === 0) return;
    usedIds.add(message.id);
    selected.set(i, candidate.line);
    consumed += candidate.tokens;
  };

  // Priority: spend budget on conversational turns first, then tool payloads, so under
  // pressure it is tool output that drops out — not user/assistant turns.
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isAssistantToolPayloadMessage(messages[i])) continue;
    selectMessage(i);
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!isAssistantToolPayloadMessage(messages[i])) continue;
    selectMessage(i);
  }

  // Emit in original (chronological) order. The passes above choose *which* messages
  // survive the budget; they must not reorder them, or a later turn's tool payload
  // renders ahead of an earlier user/assistant message.
  const lines = Array.from(selected.keys())
    .sort((a, b) => a - b)
    .map((i) => selected.get(i) as string);
  return { lines, consumedTokens: consumed };
}

// The roster is ambient: every turn lists the skills the model could activate, so
// discovery never depends on a keyword in the prompt. Bodies stay lazy — only names and
// descriptions ride along; `skill-activate` loads the full instructions on demand.
const SKILL_ROSTER_CONTEXT_FRACTION = 0.01;
const SKILL_ROSTER_DESCRIPTION_MAX_CHARS = 250;

function skillRosterLine(activeSkills: ChatRequest["activeSkills"], contextMaxTokens: number): string | null {
  const active = new Set((activeSkills ?? []).map((s) => s.name));
  const available = getLoadedSkills().filter((s) => !active.has(s.name));
  if (available.length === 0) return null;
  const cap = Math.floor(contextMaxTokens * SKILL_ROSTER_CONTEXT_FRACTION);
  const header = "SYSTEM: Available skills — activate one with `skill-activate` when its use matches the task:";
  // Fit whole entries under the cap rather than blindly truncating the joined string —
  // a mid-entry cut would emit a malformed skill line. Drop by whole skill and log the
  // omission so a roster that outgrows its cap never silently reads as complete.
  const kept: string[] = [];
  let omitted = 0;
  let tokens = estimateTokens(header);
  for (const s of available) {
    const desc =
      s.description.length > SKILL_ROSTER_DESCRIPTION_MAX_CHARS
        ? `${s.description.slice(0, SKILL_ROSTER_DESCRIPTION_MAX_CHARS - 1)}…`
        : s.description;
    const entry = `- ${s.name}: ${desc}`;
    const entryTokens = estimateTokens(`\n${entry}`);
    if (tokens + entryTokens > cap) {
      omitted += 1;
      continue;
    }
    kept.push(entry);
    tokens += entryTokens;
  }
  if (omitted > 0) log.warn("skill roster truncated to fit cap", { omitted, cap });
  if (kept.length === 0) return null;
  return `${header}\n${kept.join("\n")}`;
}

type DroppedSkill = { name: string; tokens: number; remaining: number };
type FittedSkill = { skill: ActiveSkill; tokens: number };

function formatTokenCount(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;
}

// Reserve budget for the system-prefix skill bodies so history fits around them. Overflow is
// pathological (a few k against 170k) — drop best-effort, never a hard request failure.
function fitActiveSkills(
  activeSkills: ActiveSkill[],
  budget: PromptTokenBudget,
): { fitted: FittedSkill[]; dropped: DroppedSkill[]; fittedTokens: number } {
  const fitted: FittedSkill[] = [];
  const dropped: DroppedSkill[] = [];
  let fittedTokens = 0;
  for (const skill of activeSkills) {
    const tokens = estimateTokens(renderActiveSkillBlock(skill));
    if (tokens > budget.remaining()) {
      dropped.push({ name: skill.name, tokens, remaining: budget.remaining() });
      continue;
    }
    budget.consume(tokens);
    fitted.push({ skill, tokens });
    fittedTokens += tokens;
  }
  return { fitted, dropped, fittedTokens };
}

export function createAgentInput(
  req: ChatRequest,
  options: { systemPromptTokens?: number; toolTokens?: number; contextMaxTokens: number },
): {
  input: string;
  skillsForPrompt: ActiveSkill[];
  droppedSkills: DroppedSkill[];
  usage: {
    inputTokens: number;
    inputBudgetTokens: number;
    systemPromptTokens: number;
    toolTokens: number;
    skillTokens: number;
    memoryTokens: number;
    messageTokens: number;
    includedHistoryMessages: number;
    totalHistoryMessages: number;
  };
  drop?: WindowDrop;
} {
  const contextMaxTokens = options.contextMaxTokens;
  const requestedSystemTokens = options.systemPromptTokens ?? 0;
  const requestedToolTokens = options.toolTokens ?? 0;
  const lines: string[] = [];
  const usedIds = new Set<string>();
  let includedSkillTokens = 0;
  const tokenBudget = createPromptTokenBudget(contextMaxTokens);
  tokenBudget.consume(requestedSystemTokens);
  tokenBudget.consume(requestedToolTokens);

  const userLine = `USER: ${req.message.trim()}`;
  const userTokens = estimateTokens(userLine);
  tokenBudget.consume(userTokens);

  const skillFit = fitActiveSkills(req.activeSkills ?? [], tokenBudget);
  includedSkillTokens = skillFit.fittedTokens;

  if (skillFit.dropped.length > 0) {
    // Unconditional: a dropped skill means the model lacks guidance it believes is active, so this
    // must never be silently skipped (the ~20-token note yields to nothing; the real overflow
    // backstop is estimatePromptSize). The full drop is also on the trace via lifecycle-prepare.
    const note = `SYSTEM: Skill(s) not loaded (over budget): ${skillFit.dropped.map((d) => d.name).join(", ")}.`;
    lines.push(note);
    tokenBudget.consume(estimateTokens(note));
  }

  if (skillFit.fitted.length > 0) {
    const summary = skillFit.fitted.map((f) => `${f.skill.name} (${formatTokenCount(f.tokens)})`).join(", ");
    const costLine = `SYSTEM: Active skills: ${summary} — skill-deactivate when no longer needed.`;
    const costTokens = estimateTokens(costLine);
    if (costTokens <= tokenBudget.remaining()) {
      lines.push(costLine);
      tokenBudget.consume(costTokens);
    }
  }

  const roster = skillRosterLine(req.activeSkills, contextMaxTokens);
  if (roster) {
    const rosterTokens = estimateTokens(roster);
    if (rosterTokens > tokenBudget.remaining()) {
      log.warn("skill roster dropped", { tokens: rosterTokens, remaining: tokenBudget.remaining() });
    } else {
      lines.push(roster);
      tokenBudget.consume(rosterTokens);
    }
  }

  for (const suggestion of req.suggestions ?? []) {
    const suggestionTokens = estimateTokens(suggestion);
    if (suggestionTokens > tokenBudget.remaining()) {
      log.warn("suggestion dropped", { tokens: suggestionTokens, remaining: tokenBudget.remaining() });
    } else {
      lines.push(suggestion);
      tokenBudget.consume(suggestionTokens);
    }
  }

  const { kept, dropped } = recentTurns(req.history, MAX_RECENT_TURNS);
  // Read before history/notice consume budget: the cap never consults budget, so this
  // is the room it ignored when it dropped turns.
  const tokensIdleAtDrop = tokenBudget.remaining();
  const recentResult = collectLinesWithinBudget(kept, usedIds, tokenBudget.remaining());
  let drop: WindowDrop | undefined;
  if (dropped.length > 0) {
    const droppedTurns = dropped.reduce((count, m) => count + (m.role === "user" ? 1 : 0), 0);
    const droppedTokens = dropped.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    // Turns absent from the rendered prompt, not just cap-dropped ones — a tight budget
    // omits kept turns too, and the notice must not under-claim the gap. The trace keeps
    // both: droppedTurns (cap only) answers "is the cap premature", missingTurns the true gap.
    const totalUserTurns = req.history.filter((m) => isConversationalMessage(m) && m.role === "user").length;
    const renderedUserTurns = kept.filter((m) => m.role === "user" && usedIds.has(m.id)).length;
    const missingTurns = totalUserTurns - renderedUserTurns;
    drop = {
      droppedTurns,
      droppedTokens,
      tokensIdleAtDrop,
      keptHistoryTokens: recentResult.consumedTokens,
      missingTurns,
    };
    const notice = `SYSTEM: ${missingTurns} earlier turn${missingTurns === 1 ? "" : "s"} not shown here; use session-search to retrieve earlier context if needed.`;
    lines.push(notice);
    tokenBudget.consume(estimateTokens(notice));
  }
  lines.push(...recentResult.lines);

  if (lines.length > 0) lines.push("");
  lines.push(userLine);
  const input = lines.join("\n");
  const inputTokens = estimateTokens(input);

  // inputTokens covers only the composed input (history + user message); it
  // excludes system prompt tokens, which are accounted for separately via
  // options.systemPromptTokens and returned as usage.systemPromptTokens.
  return {
    input,
    skillsForPrompt: skillFit.fitted.map((f) => f.skill),
    droppedSkills: skillFit.dropped,
    usage: {
      inputTokens,
      inputBudgetTokens: contextMaxTokens,
      systemPromptTokens: requestedSystemTokens,
      toolTokens: requestedToolTokens,
      skillTokens: includedSkillTokens,
      memoryTokens: 0,
      messageTokens: inputTokens,
      includedHistoryMessages: usedIds.size,
      totalHistoryMessages: req.history.length,
    },
    drop,
  };
}
