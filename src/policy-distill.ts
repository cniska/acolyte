import { readStore } from "./storage";
import type { Message, Session } from "./types";

const DEFAULT_SESSION_LIMIT = 40;
const DEFAULT_MIN_OCCURRENCES = 2;
const MAX_CANDIDATES = 12;

const LEADING_FILLER = [
  /^please\s+/i,
  /^pls\s+/i,
  /^can we\s+/i,
  /^could we\s+/i,
  /^should we\s+/i,
  /^i think\s+/i,
  /^let(?:')?s\s+/i,
  /^we should\s+/i,
];

const SHOULD_SIGNAL = /\b(should|shouldn't|shouldnt|must|need to|don't|dont|avoid|prefer|focus on|no need)\b/i;

export type PolicyCandidate = {
  normalized: string;
  count: number;
  examples: string[];
};

export type DistillOptions = {
  sessions?: number;
  minOccurrences?: number;
};

export function normalizePolicySignal(text: string): string | null {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length < 6 || trimmed.length > 220) {
    return null;
  }
  if (!SHOULD_SIGNAL.test(trimmed)) {
    return null;
  }

  let next = trimmed;
  for (const pattern of LEADING_FILLER) {
    next = next.replace(pattern, "");
  }

  next = next
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return next.length >= 6 ? next : null;
}

export function collectPolicyCandidates(
  messages: Message[],
  minOccurrences = DEFAULT_MIN_OCCURRENCES,
): PolicyCandidate[] {
  const grouped = new Map<string, { count: number; examples: string[] }>();

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    const normalized = normalizePolicySignal(message.content);
    if (!normalized) {
      continue;
    }
    const entry = grouped.get(normalized) ?? { count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < 3) {
      entry.examples.push(message.content.trim());
    }
    grouped.set(normalized, entry);
  }

  return [...grouped.entries()]
    .filter(([, entry]) => entry.count >= minOccurrences)
    .map(([normalized, entry]) => ({
      normalized,
      count: entry.count,
      examples: entry.examples,
    }))
    .sort((a, b) => b.count - a.count || a.normalized.localeCompare(b.normalized))
    .slice(0, MAX_CANDIDATES);
}

export function formatPolicyDistillation(candidates: PolicyCandidate[], scannedSessionCount: number): string {
  const lines: string[] = [];
  lines.push(`Scanned ${scannedSessionCount} sessions.`);
  if (candidates.length === 0) {
    lines.push("No repeated policy signals found.");
    lines.push("Tip: repeat explicit preference statements; rerun this command after more chat history.");
    return lines.join("\n");
  }

  lines.push(`Found ${candidates.length} repeated policy signals.`);
  lines.push("");
  lines.push("Proposed policy updates (review before applying):");

  for (const [index, candidate] of candidates.entries()) {
    lines.push(`${index + 1}. ${candidate.normalized} (${candidate.count}x)`);
    if (candidate.examples[0]) {
      lines.push(`   e.g. "${candidate.examples[0]}"`);
    }
  }

  lines.push("");
  lines.push("Suggested next step:");
  lines.push("- Convert accepted items into AGENTS.md rules or skill instructions.");
  return lines.join("\n");
}

function parseArgValue(args: string[], flag: string): string | undefined {
  const idx = args.findIndex((arg) => arg === flag);
  if (idx < 0) {
    return undefined;
  }
  return args[idx + 1];
}

export function parseDistillOptions(
  args: string[],
): { ok: true; options: Required<DistillOptions> } | { ok: false; error: string } {
  const limitRaw = parseArgValue(args, "--sessions");
  const minRaw = parseArgValue(args, "--min");
  const sessionLimit = Number(limitRaw ?? DEFAULT_SESSION_LIMIT);
  const minOccurrences = Number(minRaw ?? DEFAULT_MIN_OCCURRENCES);

  if (!Number.isFinite(sessionLimit) || sessionLimit < 1) {
    return { ok: false, error: "Invalid --sessions value. Expected a positive integer." };
  }
  if (!Number.isFinite(minOccurrences) || minOccurrences < 2) {
    return { ok: false, error: "Invalid --min value. Expected an integer >= 2." };
  }

  return {
    ok: true,
    options: {
      sessions: Math.floor(sessionLimit),
      minOccurrences: Math.floor(minOccurrences),
    },
  };
}

export function distillPolicyFromSessions(sessions: Session[], options: DistillOptions = {}): string {
  const candidates = distillPolicyCandidatesFromSessions(sessions, options);
  const sessionLimit = options.sessions ?? DEFAULT_SESSION_LIMIT;
  const scopedSessions = sessions.slice(0, sessionLimit);
  return formatPolicyDistillation(candidates, scopedSessions.length);
}

export function distillPolicyCandidatesFromSessions(
  sessions: Session[],
  options: DistillOptions = {},
): PolicyCandidate[] {
  const sessionLimit = options.sessions ?? DEFAULT_SESSION_LIMIT;
  const minOccurrences = options.minOccurrences ?? DEFAULT_MIN_OCCURRENCES;
  const scopedSessions = sessions.slice(0, sessionLimit);
  const messages = scopedSessions.flatMap((session) => session.messages);
  return collectPolicyCandidates(messages, minOccurrences);
}

export async function runPolicyDistill(args: string[]): Promise<void> {
  const parsed = parseDistillOptions(args);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  const store = await readStore();
  const output = distillPolicyFromSessions(store.sessions, parsed.options);
  process.stdout.write(`${output}\n`);
}

if (import.meta.main) {
  runPolicyDistill(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
