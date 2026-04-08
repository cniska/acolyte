import { estimateTokens } from "./agent-input";

export type DistillScope = "session" | "project" | "user";

type ParsedFact = { scope: DistillScope; content: string; topic: string | null };

export type SplitResult = {
  facts: ParsedFact[];
  sessionCount: number;
  projectCount: number;
  userCount: number;
  droppedUntaggedCount: number;
  droppedMalformedCount: number;
};

function stripTrailingSurrogate(s: string): string {
  if (s.length === 0) return s;
  const last = s.charCodeAt(s.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) return s.slice(0, -1);
  return s;
}

const CHARS_PER_TOKEN_ESTIMATE = 4;
const TEXT_SHRINK_RATIO = 0.9;

export function clampToTokenEstimate(content: string, maxTokens: number): string {
  const text = content.trim();
  if (!text) return "";
  if (maxTokens <= 0) return "";
  if (estimateTokens(text) <= maxTokens) return text;

  let clamped = stripTrailingSurrogate(text.slice(0, Math.max(1, maxTokens * CHARS_PER_TOKEN_ESTIMATE))).trim();
  while (clamped.length > 0 && estimateTokens(clamped) > maxTokens) {
    clamped = stripTrailingSurrogate(clamped.slice(0, Math.floor(clamped.length * TEXT_SHRINK_RATIO))).trim();
  }
  return clamped;
}

export function normalizeMemoryText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function parseObserveDirective(line: string): DistillScope | null {
  const match = line.trim().match(/^@observe\s+(project|user|session)$/i);
  return match ? (match[1].toLowerCase() as DistillScope) : null;
}

export function parseTopicDirective(line: string): string | null {
  const match = line.trim().match(/^@topic\s+(\S+)$/i);
  return match ? match[1].toLowerCase() : null;
}

export function hasMalformedObserveDirective(line: string): boolean {
  return /^@observe\b/i.test(line.trim()) && !parseObserveDirective(line);
}

export function splitScopedObservation(observed: string): SplitResult {
  const lines = observed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const facts: ParsedFact[] = [];
  let droppedUntaggedCount = 0;
  let droppedMalformedCount = 0;
  let pendingScope: DistillScope | null = null;
  let pendingTopic: string | null = null;
  for (const line of lines) {
    const scope = parseObserveDirective(line);
    if (scope) {
      pendingScope = scope;
      pendingTopic = null;
      continue;
    }
    if (hasMalformedObserveDirective(line)) {
      droppedMalformedCount += 1;
      pendingScope = null;
      pendingTopic = null;
      continue;
    }
    const topic = parseTopicDirective(line);
    if (topic) {
      pendingTopic = topic;
      continue;
    }
    if (!pendingScope) {
      droppedUntaggedCount += 1;
      continue;
    }
    facts.push({ scope: pendingScope, content: line, topic: pendingTopic });
    pendingScope = null;
    pendingTopic = null;
  }

  return {
    facts,
    sessionCount: facts.filter((f) => f.scope === "session").length,
    projectCount: facts.filter((f) => f.scope === "project").length,
    userCount: facts.filter((f) => f.scope === "user").length,
    droppedUntaggedCount,
    droppedMalformedCount,
  };
}
