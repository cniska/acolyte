import { estimateTokens } from "./agent-input";

export type DistillScope = "session" | "project" | "user";

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
