import { z } from "zod";
import type { ToolName } from "./tool-names";

export type GuardEvent = { guardId: string; toolName: ToolName; action: "blocked" | "flag_set"; detail?: string };

export type ToolCallRecord = { toolName: ToolName; args: Record<string, unknown>; taskId?: string };

export type SessionContext = {
  callLog: ToolCallRecord[];
  taskId?: string;
  flags: Record<string, unknown>;
  onGuard?: (event: GuardEvent) => void;
};

export type GuardInput = {
  toolName: ToolName;
  args: Record<string, unknown>;
  session: SessionContext;
};

export type ToolGuard = {
  id: string;
  description: string;
  appliesTo: "all" | readonly ToolName[];
  check: (input: GuardInput) => void;
};

export function createSessionContext(taskId?: string): SessionContext {
  return { callLog: [], taskId, flags: {} };
}

function scopedCallLog(session: SessionContext): ToolCallRecord[] {
  const taskId = session.taskId;
  if (!taskId) return session.callLog;
  return session.callLog.filter((entry) => entry.taskId === taskId);
}

function normalizePath(p: string): string {
  return p.replace(/\/+$/, "").replace(/^\.\//, "");
}

function extractReadPaths(args: Record<string, unknown>): string[] {
  const paths = args.paths;
  if (!Array.isArray(paths)) return [];
  const out: string[] = [];
  for (const entry of paths) {
    if (!entry || typeof entry !== "object") continue;
    const path = (entry as { path?: unknown }).path;
    if (typeof path === "string" && path.trim().length > 0) out.push(normalizePath(path.trim()));
  }
  return out;
}

function extractSearchPatterns(args: Record<string, unknown>): string[] {
  const normalize = (value: string): string => {
    const trimmed = value.trim().toLowerCase();
    const boundaryMatch = trimmed.match(/^\\b(.+)\\b$/);
    const core = boundaryMatch?.[1]?.trim() ?? trimmed;
    return core.replace(/^["'`](.+)["'`]$/, "$1");
  };
  const patterns = new Set<string>();
  const single = args.pattern;
  if (typeof single === "string" && single.trim().length > 0) patterns.add(normalize(single));
  const multi = args.patterns;
  if (Array.isArray(multi)) {
    for (const entry of multi) {
      if (typeof entry !== "string") continue;
      const trimmed = normalize(entry);
      if (trimmed.length > 0) patterns.add(trimmed);
    }
  }
  return Array.from(patterns).sort();
}

function extractSearchScope(args: Record<string, unknown>): string[] {
  const raw = args.paths;
  if (!Array.isArray(raw) || raw.length === 0) return ["__workspace__"];
  const scope = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = normalizePath(entry.trim().toLowerCase());
    if (trimmed.length > 0) scope.add(trimmed);
  }
  if (scope.size === 0) return ["__workspace__"];
  return Array.from(scope).sort();
}

function extractFindPatterns(args: Record<string, unknown>): string[] {
  const patterns = args.patterns;
  if (!Array.isArray(patterns)) return [];
  const normalized = new Set<string>();
  for (const entry of patterns) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim().toLowerCase();
    if (trimmed.length > 0) normalized.add(trimmed);
  }
  return Array.from(normalized).sort();
}

function includesUniversalFindPattern(patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const trimmed = pattern.trim();
    return trimmed === "*" || trimmed === "**/*";
  });
}

function sameArray(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isSubsetSet(subset: readonly string[], superset: readonly string[]): boolean {
  if (subset.length > superset.length) return false;
  const sup = new Set(superset);
  return subset.every((item) => sup.has(item));
}

function isWorkspaceScope(scope: readonly string[]): boolean {
  return scope.length === 1 && scope[0] === "__workspace__";
}

type RedundantQueryKind = "narrower" | "scope-narrowing";

function redundantQueryKind(input: {
  toolName: ToolName;
  session: SessionContext;
  currentPatterns: readonly string[];
  currentScope: readonly string[];
  extractPatterns: (args: Record<string, unknown>) => string[];
  extractScope: (args: Record<string, unknown>) => string[];
}): RedundantQueryKind | null {
  const { toolName, session, currentPatterns, currentScope, extractPatterns, extractScope } = input;
  for (const entry of scopedCallLog(session)) {
    if (entry.toolName !== toolName) continue;
    const priorPatterns = extractPatterns(entry.args);
    const priorScope = extractScope(entry.args);
    const sameScope = sameArray(priorScope, currentScope);
    const narrowingScope = isWorkspaceScope(priorScope) && !isWorkspaceScope(currentScope);
    if (!sameScope && !narrowingScope) continue;
    if (sameScope && sameArray(priorPatterns, currentPatterns)) continue;
    const isProperSubset = currentPatterns.length < priorPatterns.length && isSubsetSet(currentPatterns, priorPatterns);
    if (isProperSubset) return narrowingScope ? "scope-narrowing" : "narrower";
  }
  return null;
}

function isShellReadFallback(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed.length === 0) return false;
  const normalized = trimmed.replace(/\s+/g, " ").toLowerCase();
  const disallowed = /\b(cat|sed|head|tail|nl|wc|ls|find|grep|rg)\b/;
  if (!disallowed.test(normalized)) return false;
  const allowedContext = /\b(verify|test|build|lint|format|check|ci|coverage|compile|start|dev|serve|run)\b/;
  return !allowedContext.test(normalized);
}

function normalizeGuardArgValue(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => normalizeGuardArgValue(entry));
    if (normalized.every((entry) => typeof entry === "string")) {
      return (normalized as string[]).slice().sort();
    }
    return normalized;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const [key, entry] of entries) out[key] = normalizeGuardArgValue(entry);
    return out;
  }
  return value;
}

function guardArgsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(normalizeGuardArgValue(a)) === JSON.stringify(normalizeGuardArgValue(b));
}

const duplicateConsecutiveCallGuard: ToolGuard = {
  id: "duplicate-consecutive-call",
  description: "Block immediate duplicate tool calls with effectively identical arguments.",
  appliesTo: "all",
  check({ toolName, args, session }) {
    const calls = scopedCallLog(session);
    const last = calls[calls.length - 1];
    if (!last || last.toolName !== toolName) return;
    if (!guardArgsEqual(last.args, args)) return;
    session.onGuard?.({ guardId: "duplicate-consecutive-call", toolName, action: "blocked", detail: "duplicate-call" });
    throw new Error(
      `Duplicate ${toolName} call detected with unchanged arguments. Reuse previous result or change inputs.`,
    );
  },
};

const noRewriteGuard: ToolGuard = {
  id: "no-rewrite",
  description: "Block delete-file on a path that was previously read — use edit-file instead.",
  appliesTo: ["delete-file"],
  check({ toolName, args, session }) {
    const rawPaths = Array.isArray(args.paths) ? args.paths : typeof args.path === "string" ? [args.path] : [];
    const deletePaths = rawPaths
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (deletePaths.length === 0) return;
    for (const deletePath of deletePaths) {
      const normalized = normalizePath(deletePath);
      const wasRead = scopedCallLog(session).some((entry) => {
        if (entry.toolName !== "read-file") return false;
        const paths = entry.args.paths;
        if (!Array.isArray(paths)) return false;
        return (paths as Array<{ path?: string }>).some((p) => {
          if (typeof p.path !== "string") return false;
          const n = normalizePath(p.path);
          return n === normalized || n.endsWith(`/${normalized}`) || normalized.endsWith(`/${n}`);
        });
      });
      if (!wasRead) continue;
      session.onGuard?.({ guardId: "no-rewrite", toolName, action: "blocked", detail: deletePath });
      throw new Error(
        `Cannot delete "${deletePath}" — it was read this session. Use edit-file to modify it instead of deleting and recreating.`,
      );
    }
  },
};

const excessiveFileLoopGuard: ToolGuard = {
  id: "excessive-file-loop",
  description: "Block repeated read/edit churn on the same file to force a strategy change.",
  appliesTo: ["read-file", "edit-file"],
  check({ toolName, args, session }) {
    const targetPaths =
      toolName === "edit-file"
        ? typeof args.path === "string" && args.path.trim().length > 0
          ? [normalizePath(args.path.trim())]
          : []
        : extractReadPaths(args);
    if (targetPaths.length === 0) return;
    const pathCounts = new Map<string, { readCount: number; editCount: number }>();
    const countsForPath = (path: string): { readCount: number; editCount: number } => {
      const existing = pathCounts.get(path);
      if (existing) return existing;
      const created = { readCount: 0, editCount: 0 };
      pathCounts.set(path, created);
      return created;
    };
    for (const entry of scopedCallLog(session)) {
      if (entry.toolName === "read-file") {
        for (const path of extractReadPaths(entry.args)) {
          countsForPath(path).readCount += 1;
        }
      } else if (entry.toolName === "edit-file" || entry.toolName === "edit-code") {
        const path = entry.args.path;
        if (typeof path !== "string") continue;
        countsForPath(normalizePath(path)).editCount += 1;
      }
    }

    if (toolName === "read-file") {
      const duplicatePreEdit = targetPaths.find((path) => {
        const counts = countsForPath(path);
        return counts.readCount >= 1 && counts.editCount === 0;
      });
      if (duplicatePreEdit) {
        session.onGuard?.({ guardId: "excessive-file-loop", toolName, action: "blocked", detail: duplicatePreEdit });
        throw new Error(
          `Already read "${duplicatePreEdit}" this turn. Reuse prior context and only read unread paths in the next batched read-file call.`,
        );
      }
    }

    if (targetPaths.length !== 1) return;
    const target = targetPaths[0];
    const { readCount, editCount } = countsForPath(target);

    const combined = readCount + editCount;
    if (combined < 12 || readCount < 5 || editCount < 5) return;

    session.onGuard?.({ guardId: "excessive-file-loop", toolName, action: "blocked", detail: target });
    throw new Error(
      `Repeated read/edit loop detected for "${target}". Stop incremental tweaks. ` +
        "Use one consolidated edit (line-range block or edit-code), then run verify.",
    );
  },
};

const excessiveSearchLoopGuard: ToolGuard = {
  id: "excessive-search-loop",
  description: "Block repeated search-only churn to force an evidence-based conclusion.",
  appliesTo: ["search-files"],
  check({ toolName, args, session }) {
    const currentPatterns = extractSearchPatterns(args);
    const currentScope = extractSearchScope(args);
    const redundant = redundantQueryKind({
      toolName,
      session,
      currentPatterns,
      currentScope,
      extractPatterns: extractSearchPatterns,
      extractScope: extractSearchScope,
    });
    if (redundant === "scope-narrowing") {
      session.onGuard?.({
        guardId: "excessive-search-loop",
        toolName,
        action: "blocked",
        detail: "redundant-scope-narrowing",
      });
      throw new Error(
        "Redundant scoped search-files call detected. Prior workspace search already covers these patterns.",
      );
    }
    if (redundant === "narrower") {
      session.onGuard?.({
        guardId: "excessive-search-loop",
        toolName,
        action: "blocked",
        detail: "narrower-than-prior",
      });
      throw new Error(
        "Redundant narrower search-files call detected. Current patterns are already covered by a prior search in the same scope.",
      );
    }

    let searchCount = 0;
    let readCount = 0;
    let writeCount = 0;
    for (const entry of scopedCallLog(session)) {
      if (entry.toolName === "search-files") {
        searchCount += 1;
      } else if (entry.toolName === "read-file") {
        readCount += 1;
      } else if (entry.toolName === "edit-file" || entry.toolName === "edit-code" || entry.toolName === "create-file") {
        writeCount += 1;
      }
    }

    if (searchCount < 4 || readCount > 0 || writeCount > 0) return;

    session.onGuard?.({ guardId: "excessive-search-loop", toolName, action: "blocked", detail: String(searchCount) });
    throw new Error(
      "Repeated search-files loop detected without reads/writes. Stop synonym searching and conclude from current evidence.",
    );
  },
};

const excessiveFindLoopGuard: ToolGuard = {
  id: "excessive-find-loop",
  description: "Block repeated find-only churn to force direct reads or a conclusion.",
  appliesTo: ["find-files"],
  check({ toolName, args, session }) {
    const currentPatterns = extractFindPatterns(args);
    const currentScope = extractSearchScope(args);
    for (const entry of scopedCallLog(session)) {
      if (entry.toolName !== "find-files") continue;
      const priorPatterns = extractFindPatterns(entry.args);
      const priorScope = extractSearchScope(entry.args);
      const sameScope = sameArray(priorScope, currentScope);
      const narrowingScope = isWorkspaceScope(priorScope) && !isWorkspaceScope(currentScope);
      if (!sameScope && !narrowingScope) continue;
      if (includesUniversalFindPattern(priorPatterns)) {
        session.onGuard?.({
          guardId: "excessive-find-loop",
          toolName,
          action: "blocked",
          detail: "covered-by-universal-find",
        });
        throw new Error("Redundant find-files call detected. Prior universal find already covers this scope.");
      }
    }
    const redundant = redundantQueryKind({
      toolName,
      session,
      currentPatterns,
      currentScope,
      extractPatterns: extractFindPatterns,
      extractScope: extractSearchScope,
    });
    if (redundant === "scope-narrowing") {
      session.onGuard?.({
        guardId: "excessive-find-loop",
        toolName,
        action: "blocked",
        detail: "redundant-scope-narrowing",
      });
      throw new Error("Redundant scoped find-files call detected. Prior workspace find already covers these patterns.");
    }
    if (redundant === "narrower") {
      session.onGuard?.({ guardId: "excessive-find-loop", toolName, action: "blocked", detail: "narrower-than-prior" });
      throw new Error(
        "Redundant narrower find-files call detected. Current patterns are already covered by a prior find in the same scope.",
      );
    }

    let findCount = 0;
    let readCount = 0;
    let writeCount = 0;
    for (const entry of scopedCallLog(session)) {
      if (entry.toolName === "find-files") {
        findCount += 1;
      } else if (entry.toolName === "read-file") {
        readCount += 1;
      } else if (entry.toolName === "edit-file" || entry.toolName === "edit-code" || entry.toolName === "create-file") {
        writeCount += 1;
      }
    }

    if (findCount < 4 || readCount > 0 || writeCount > 0) return;

    session.onGuard?.({ guardId: "excessive-find-loop", toolName, action: "blocked", detail: String(findCount) });
    throw new Error(
      "Repeated find-files loop detected without reads/writes. Stop broad discovery and read the best candidate file(s) directly.",
    );
  },
};

const verifyRanGuard: ToolGuard = {
  id: "verify-ran",
  description: "Set session flag when run-command executes a verify command.",
  appliesTo: ["run-command"],
  check({ toolName, args, session }) {
    if (typeof args.command !== "string") return;
    if (!/\bverify\b/i.test(args.command)) return;

    const calls = scopedCallLog(session);
    const lastVerifyIndex = (() => {
      for (let i = calls.length - 1; i >= 0; i -= 1) {
        const entry = calls[i];
        if (entry.toolName !== "run-command") continue;
        const cmd = typeof entry.args.command === "string" ? entry.args.command : "";
        if (/\bverify\b/i.test(cmd)) return i;
      }
      return -1;
    })();

    if (lastVerifyIndex >= 0) {
      let wroteAfterLastVerify = false;
      for (let i = lastVerifyIndex + 1; i < calls.length; i += 1) {
        const tool = calls[i]?.toolName;
        if (tool === "edit-file" || tool === "edit-code" || tool === "create-file" || tool === "delete-file") {
          wroteAfterLastVerify = true;
          break;
        }
      }
      if (!wroteAfterLastVerify) {
        session.onGuard?.({ guardId: "verify-ran", toolName, action: "blocked", detail: "duplicate-verify" });
        throw new Error("verify already ran this turn and no writes happened since; avoid redundant verify reruns.");
      }
    }

    session.flags.verifyRan = true;
    session.onGuard?.({ guardId: "verify-ran", toolName, action: "flag_set", detail: "verifyRan" });
  },
};

const noShellReadFallbackGuard: ToolGuard = {
  id: "no-shell-read-fallback",
  description: "Block run-command shell fallbacks for file discovery/reading tools.",
  appliesTo: ["run-command"],
  check({ toolName, args, session }) {
    const command = typeof args.command === "string" ? args.command : "";
    if (!isShellReadFallback(command)) return;
    session.onGuard?.({ guardId: "no-shell-read-fallback", toolName, action: "blocked", detail: command });
    throw new Error(
      "Do not use shell commands for file reading/searching. Use read-file, find-files, or search-files instead.",
    );
  },
};

export const guardIdSchema = z.enum([
  "duplicate-consecutive-call",
  "no-rewrite",
  "excessive-file-loop",
  "excessive-find-loop",
  "excessive-search-loop",
  "verify-ran",
  "no-shell-read-fallback",
]);

export type GuardId = z.infer<typeof guardIdSchema>;
const GUARD_ID_SET = new Set<string>(guardIdSchema.options);

const GUARDS: ToolGuard[] = [
  duplicateConsecutiveCallGuard,
  noRewriteGuard,
  excessiveFileLoopGuard,
  excessiveFindLoopGuard,
  excessiveSearchLoopGuard,
  verifyRanGuard,
  noShellReadFallbackGuard,
];

function disabledGuardIds(session: SessionContext): Set<string> {
  const value = session.flags.disabledGuards;
  if (!Array.isArray(value)) return new Set();
  const ids = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && GUARD_ID_SET.has(entry));
  return new Set(ids);
}

export function runGuards(input: GuardInput): void {
  const disabled = disabledGuardIds(input.session);
  for (const guard of GUARDS) {
    if (disabled.has(guard.id)) continue;
    if (guard.appliesTo !== "all" && !guard.appliesTo.includes(input.toolName)) continue;
    guard.check(input);
  }
}

export function recordCall(session: SessionContext, toolName: ToolName, args: Record<string, unknown>): void {
  session.callLog.push({ toolName, args, taskId: session.taskId });
}
