import { modeForTool } from "./agent-modes";
import { INITIAL_MAX_STEPS, TOTAL_MAX_STEPS } from "./lifecycle-constants";
import {
  extractFindPatterns,
  extractReadPaths,
  extractSearchPatterns,
  extractSearchScope,
  includesUniversalFindPattern,
  normalizePath,
} from "./tool-arg-paths";

export type GuardEvent = { guardId: string; toolName: string; action: "blocked" | "flag_set"; detail?: string };

export type ToolCallRecord = { toolName: string; args: Record<string, unknown>; taskId?: string; mode?: string };

export type SessionContext = {
  callLog: ToolCallRecord[];
  taskId?: string;
  mode?: string;
  flags: Record<string, unknown>;
  onGuard?: (event: GuardEvent) => void;
};

export type GuardInput = {
  toolName: string;
  args: Record<string, unknown>;
  session: SessionContext;
};

export type ToolGuard = {
  id: string;
  description: string;
  appliesTo: "all" | readonly string[];
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
  toolName: string;
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
          return n === normalized;
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
  description: "Block excessive read/edit churn on the same file to force a strategy change.",
  appliesTo: ["read-file", "edit-file"],
  check({ toolName, args, session }) {
    const targetPaths =
      toolName === "edit-file"
        ? typeof args.path === "string" && args.path.trim().length > 0
          ? [normalizePath(args.path.trim())]
          : []
        : extractReadPaths(args, { normalize: true });
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
        for (const path of extractReadPaths(entry.args, { normalize: true })) {
          countsForPath(path).readCount += 1;
        }
      } else if (entry.toolName === "edit-file" || entry.toolName === "edit-code") {
        const path = entry.args.path;
        if (typeof path !== "string") continue;
        countsForPath(normalizePath(path)).editCount += 1;
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

const redundantVerifyGuard: ToolGuard = {
  id: "redundant-verify",
  description: "Block redundant verify runs when no writes happened since the last one.",
  appliesTo: ["run-command"],
  check({ toolName, session }) {
    if (session.mode !== "verify") return;

    const calls = scopedCallLog(session);
    const lastVerifyRunIndex = (() => {
      for (let i = calls.length - 1; i >= 0; i -= 1) {
        if (calls[i]?.toolName === "run-command" && calls[i]?.mode === "verify") return i;
      }
      return -1;
    })();

    if (lastVerifyRunIndex < 0) return;

    let wroteAfterLastVerify = false;
    for (let i = lastVerifyRunIndex + 1; i < calls.length; i += 1) {
      const tool = calls[i]?.toolName;
      if (tool === "edit-file" || tool === "edit-code" || tool === "create-file" || tool === "delete-file") {
        wroteAfterLastVerify = true;
        break;
      }
    }
    if (!wroteAfterLastVerify) {
      session.onGuard?.({ guardId: "redundant-verify", toolName, action: "blocked", detail: "duplicate-verify" });
      throw new Error("verify already ran this turn and no writes happened since; avoid redundant verify reruns.");
    }
  },
};

const stepBudgetGuard: ToolGuard = {
  id: "step-budget",
  description: "Enforce per-cycle and total step limits.",
  appliesTo: "all",
  check({ toolName, session }) {
    const cycleLimit = (session.flags.cycleStepLimit as number | undefined) ?? INITIAL_MAX_STEPS;
    const cycleCount = (session.flags.cycleStepCount as number | undefined) ?? 0;
    const totalLimit = (session.flags.totalStepLimit as number | undefined) ?? TOTAL_MAX_STEPS;
    const totalCount = session.callLog.length;

    if (totalCount >= totalLimit) {
      session.onGuard?.({ guardId: "step-budget", toolName, action: "blocked", detail: "total-limit" });
      throw new Error(`Total step budget exhausted (${totalLimit} tool calls). Commit what you have.`);
    }
    if (cycleCount >= cycleLimit) {
      session.onGuard?.({ guardId: "step-budget", toolName, action: "blocked", detail: "cycle-limit" });
      throw new Error(`Cycle step budget exhausted (${cycleLimit} tool calls). Wrap up current phase.`);
    }
    session.flags.cycleStepCount = cycleCount + 1;
  },
};

export function resetCycleStepCount(session: SessionContext, limit?: number): void {
  session.flags.cycleStepCount = 0;
  if (limit !== undefined) session.flags.cycleStepLimit = limit;
}

const modePromotionGuard: ToolGuard = {
  id: "mode-promotion",
  description: "Auto-promote plan → work when a write tool is called.",
  appliesTo: "all",
  check({ toolName, session }) {
    if (session.mode !== "plan") return;
    if (modeForTool(toolName) !== "work") return;
    session.mode = "work";
    session.onGuard?.({ guardId: "mode-promotion", toolName, action: "flag_set", detail: "plan-to-work" });
  },
};

const GUARDS: ToolGuard[] = [
  stepBudgetGuard,
  modePromotionGuard,
  duplicateConsecutiveCallGuard,
  noRewriteGuard,
  excessiveFileLoopGuard,
  excessiveFindLoopGuard,
  excessiveSearchLoopGuard,
  redundantVerifyGuard,
];

export function runGuards(input: GuardInput): void {
  for (const guard of GUARDS) {
    if (guard.appliesTo !== "all" && !guard.appliesTo.includes(input.toolName)) continue;
    guard.check(input);
  }
}

export function recordCall(session: SessionContext, toolName: string, args: Record<string, unknown>): void {
  session.callLog.push({ toolName, args, taskId: session.taskId, mode: session.mode });
}
