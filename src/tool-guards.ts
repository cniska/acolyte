import { invariant } from "./assert";
import { CONSECUTIVE_GUARD_BLOCK_LIMIT, TOOL_TIMEOUT_MS } from "./lifecycle-constants";
import {
  extractFindPatterns,
  extractReadPaths,
  extractSearchPatterns,
  extractSearchScope,
  includesUniversalFindPattern,
  normalizePath,
} from "./tool-arg-paths";
import type { ToolCache } from "./tool-contract";

const DEFAULT_CYCLE_STEP_LIMIT = 80;
const DEFAULT_TOTAL_STEP_LIMIT = 200;

export type GuardEvent = {
  guardId: string;
  toolName: string;
  action: "blocked" | "flag_set";
  detail?: string;
};

export type ToolCallRecord = {
  toolName: string;
  args: Record<string, unknown>;
  taskId?: string;
  mode?: string;
  resultHash?: string;
  success?: boolean;
};

export type SessionFlags = {
  cycleStepCount?: number;
  cycleStepLimit?: number;
  totalStepLimit?: number;
  guardStats?: { blocked: number; flagSet: number };
  consecutiveBlocks?: number;
  consecutiveGuardBlockLimit?: number;
};

export type SessionContext = {
  callLog: ToolCallRecord[];
  taskId?: string;
  mode?: string;
  flags: SessionFlags;
  writeTools: ReadonlySet<string>;
  toolTimeoutMs?: number;
  onGuard?: (event: GuardEvent) => void;
  cache?: ToolCache;
  onDebug?: (event: `lifecycle.${string}`, data: Record<string, unknown>) => void;
};

const FILE_CHURN_MIN_COMBINED = 12;
const FILE_CHURN_MIN_READS = 5;
const FILE_CHURN_MIN_EDITS = 5;
const FILE_READ_ONLY_CHURN_MIN = 4;
const DISCOVERY_LOOP_MIN_CALLS = 4;

export type GuardReport = (action: "blocked" | "flag_set", detail?: string) => void;

export type GuardInput = {
  toolName: string;
  args: Record<string, unknown>;
  session: SessionContext;
  report: GuardReport;
};

export type ToolGuard = {
  id: string;
  description: string;
  tools?: readonly string[];
  check: (input: GuardInput) => void;
};

function isWriteTool(session: SessionContext, toolName: string): boolean {
  return session.writeTools.has(toolName);
}

export function createSessionContext(taskId?: string, writeTools: ReadonlySet<string> = new Set()): SessionContext {
  return {
    callLog: [],
    taskId,
    flags: { consecutiveGuardBlockLimit: CONSECUTIVE_GUARD_BLOCK_LIMIT },
    writeTools,
    toolTimeoutMs: TOOL_TIMEOUT_MS,
  };
}

export function scopedCallLog(session: SessionContext, taskId?: string): ToolCallRecord[] {
  const id = taskId ?? session.taskId;
  if (!id) return session.callLog;
  return session.callLog.filter((entry) => entry.taskId === id);
}

export function haveChangesBeenVerified(session: SessionContext, taskId: string | undefined): boolean {
  return scopedCallLog(session, taskId).some((entry) => entry.toolName === "run-command" && entry.mode === "verify");
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

function callsSinceLastVerify(session: SessionContext): ToolCallRecord[] {
  const calls = scopedCallLog(session);
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    if (calls[i]?.toolName === "run-command" && calls[i]?.mode === "verify") return calls.slice(i + 1);
  }
  return calls;
}

function editedPathsSinceLastVerify(session: SessionContext): string[] {
  const paths = new Set<string>();
  for (const entry of callsSinceLastVerify(session)) {
    if (entry.success === false) continue;
    if (!isWriteTool(session, entry.toolName)) continue;
    if (typeof entry.args.path !== "string") continue;
    const path = normalizePath(entry.args.path.trim().toLowerCase());
    if (path.length > 0) paths.add(path);
  }
  return Array.from(paths);
}

function singleEditedPathSinceLastVerify(session: SessionContext): string | undefined {
  const paths = editedPathsSinceLastVerify(session);
  return paths.length === 1 ? paths[0] : undefined;
}

type RedundantQueryKind = "narrower" | "scope-narrowing";

type ReadRequestSignature = {
  path: string;
  signature: string;
};

const WHOLE_FILE_SENTINEL_END = 1_000_000;

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

function extractReadRequestSignatures(args: Record<string, unknown>): ReadRequestSignature[] {
  const rawPaths = Array.isArray(args.paths) ? args.paths : [];
  const signatures: ReadRequestSignature[] = [];
  for (const entry of rawPaths) {
    if (!entry || typeof entry !== "object") continue;
    const pathValue = (entry as { path?: unknown }).path;
    if (typeof pathValue !== "string") continue;
    const path = normalizePath(pathValue.trim().toLowerCase());
    if (path.length === 0) continue;
    const start = (entry as { start?: unknown }).start;
    const end = (entry as { end?: unknown }).end;
    const startValue = typeof start === "number" ? String(start) : "";
    const endValue = typeof end === "number" ? String(end) : "";
    signatures.push({ path, signature: `${path}\u0000${startValue}\u0000${endValue}` });
  }
  return signatures;
}

function isWholeFileReadOfPath(args: Record<string, unknown>, path: string): boolean {
  const rawPaths = Array.isArray(args.paths) ? args.paths : [];
  if (rawPaths.length !== 1) return false;
  const [entry] = rawPaths;
  if (!entry || typeof entry !== "object") return false;
  const pathValue = (entry as { path?: unknown }).path;
  if (typeof pathValue !== "string") return false;
  const normalizedPath = normalizePath(pathValue.trim().toLowerCase());
  if (normalizedPath !== path) return false;
  const start = (entry as { start?: unknown }).start;
  const end = (entry as { end?: unknown }).end;
  if (start === undefined && end === undefined) return true;
  return start === 1 && typeof end === "number" && end >= WHOLE_FILE_SENTINEL_END;
}

function guardArgsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(normalizeGuardArgValue(a)) === JSON.stringify(normalizeGuardArgValue(b));
}

const DUPLICATE_CALL_LOOKBACK = 3;

const duplicateCallGuard: ToolGuard = {
  id: "duplicate-call",
  description: "Block near-duplicate tool calls with no state-changing tool in between.",
  check({ toolName, args, session, report }) {
    if (session.cache?.isCacheable(toolName)) return;
    const calls = scopedCallLog(session);
    const lookback = calls.slice(-DUPLICATE_CALL_LOOKBACK);
    for (let i = lookback.length - 1; i >= 0; i -= 1) {
      const prior = lookback[i];
      if (prior.toolName === toolName && guardArgsEqual(prior.args, args)) {
        report("blocked", "duplicate-call");
        throw new Error(
          `Duplicate ${toolName} call detected with unchanged arguments. Reuse previous result or change inputs.`,
        );
      }
      if (isWriteTool(session, prior.toolName)) return;
    }
  },
};

const fileChurnGuard: ToolGuard = {
  id: "file-churn",
  description: "Block excessive read/edit churn on the same file to force a strategy change.",
  tools: ["read-file", "edit-file"],
  check({ toolName, args, session, report }) {
    const targetPaths =
      toolName === "edit-file"
        ? typeof args.path === "string" && args.path.trim().length > 0
          ? [normalizePath(args.path.trim())]
          : []
        : extractReadPaths(args, { normalize: true });
    if (targetPaths.length === 0) return;
    const requestedReadSignatures =
      toolName === "read-file" ? extractReadRequestSignatures(args).map((entry) => entry.signature) : [];
    const pathCounts = new Map<string, { readCount: number; editCount: number }>();
    const readSignaturesByPath = new Map<string, Set<string>>();
    const countsForPath = (path: string): { readCount: number; editCount: number } => {
      const existing = pathCounts.get(path);
      if (existing) return existing;
      const created = { readCount: 0, editCount: 0 };
      pathCounts.set(path, created);
      return created;
    };
    const signaturesForPath = (path: string): Set<string> => {
      const existing = readSignaturesByPath.get(path);
      if (existing) return existing;
      const created = new Set<string>();
      readSignaturesByPath.set(path, created);
      return created;
    };
    const sinceLastVerify = callsSinceLastVerify(session);
    for (const entry of sinceLastVerify) {
      if (entry.toolName === "read-file") {
        for (const readEntry of extractReadRequestSignatures(entry.args)) {
          countsForPath(readEntry.path).readCount += 1;
          signaturesForPath(readEntry.path).add(readEntry.signature);
        }
      } else if (entry.success !== false && isWriteTool(session, entry.toolName) && typeof entry.args.path === "string") {
        countsForPath(normalizePath(entry.args.path)).editCount += 1;
      }
    }

    for (const target of targetPaths) {
      const { readCount, editCount } = countsForPath(target);

      if (
        toolName === "read-file" &&
        editCount > 0 &&
        requestedReadSignatures.some((signature) => signaturesForPath(target).has(signature))
      ) {
        report("blocked", target);
        throw new Error(
          `File "${target}" was already edited successfully in this turn, and this reread repeats an earlier read. ` +
            "Use the diff you already have or read a different section if you need new context.",
        );
      }

      if (toolName === "read-file" && editCount === 0 && readCount >= FILE_READ_ONLY_CHURN_MIN) {
        report("blocked", target);
        throw new Error(
          `File "${target}" has been read ${readCount} times without edits. Use the content you already have or move on.`,
        );
      }

      const combined = readCount + editCount;
      if (combined < FILE_CHURN_MIN_COMBINED || readCount < FILE_CHURN_MIN_READS || editCount < FILE_CHURN_MIN_EDITS)
        continue;

      report("blocked", target);
      throw new Error(
        `Repeated read/edit loop detected for "${target}". Stop incremental tweaks. ` +
          "Use one consolidated edit (line-range block or edit-code), then run verify.",
      );
    }
  },
};

type RedundantDiscoveryConfig = {
  id: string;
  description: string;
  tool: string;
  extractPatterns: (args: Record<string, unknown>) => string[];
  loopMessage: string;
  preCheck?: (input: GuardInput) => void;
};

function createRedundantDiscoveryGuard(config: RedundantDiscoveryConfig): ToolGuard {
  return {
    id: config.id,
    description: config.description,
    tools: [config.tool],
    check(input) {
      const { toolName, args, session, report } = input;
      config.preCheck?.(input);

      const currentPatterns = config.extractPatterns(args);
      const currentScope = extractSearchScope(args);
      const redundant = redundantQueryKind({
        toolName,
        session,
        currentPatterns,
        currentScope,
        extractPatterns: config.extractPatterns,
        extractScope: extractSearchScope,
      });
      if (redundant === "scope-narrowing") {
        report("blocked", "redundant-scope-narrowing");
        throw new Error(
          `Redundant scoped ${config.tool} call detected. Prior workspace call already covers these patterns.`,
        );
      }
      if (redundant === "narrower") {
        report("blocked", "narrower-than-prior");
        throw new Error(
          `Redundant narrower ${config.tool} call detected. Current patterns are already covered by a prior call in the same scope.`,
        );
      }

      let discoveryCount = 0;
      let readCount = 0;
      let writeCount = 0;
      for (const entry of scopedCallLog(session)) {
        if (entry.toolName === config.tool) {
          discoveryCount += 1;
        } else if (entry.toolName === "read-file") {
          readCount += 1;
        } else if (isWriteTool(session, entry.toolName)) {
          writeCount += 1;
        }
      }

      if (discoveryCount < DISCOVERY_LOOP_MIN_CALLS || readCount > 0 || writeCount > 0) return;

      report("blocked", String(discoveryCount));
      throw new Error(config.loopMessage);
    },
  };
}

const redundantSearchGuard = createRedundantDiscoveryGuard({
  id: "redundant-search",
  description: "Block repeated search-only churn to force an evidence-based conclusion.",
  tool: "search-files",
  extractPatterns: extractSearchPatterns,
  loopMessage:
    "Repeated search-files loop detected without reads/writes. Stop synonym searching and conclude from current evidence.",
  preCheck({ args, session, report }) {
    const currentScope = extractSearchScope(args);
    if (currentScope.length !== 1 || currentScope[0] === "__workspace__") return;
    const targetPath = currentScope[0];
    if (!targetPath) return;

    for (const entry of scopedCallLog(session)) {
      if (entry.success !== false && isWriteTool(session, entry.toolName)) return;
    }

    const calls = scopedCallLog(session);
    const prior = calls[calls.length - 1];
    if (!prior || prior.toolName !== "read-file") return;
    if (!isWholeFileReadOfPath(prior.args, targetPath)) return;

    report("blocked", targetPath);
    throw new Error(
      `File "${targetPath}" was already read directly in full. Do not search the same file before editing; ` +
        "use the text you already have to make the change.",
    );
  },
});

const redundantFindGuard = createRedundantDiscoveryGuard({
  id: "redundant-find",
  description: "Block repeated find-only churn to force direct reads or a conclusion.",
  tool: "find-files",
  extractPatterns: extractFindPatterns,
  loopMessage:
    "Repeated find-files loop detected without reads/writes. Stop broad discovery and read the best candidate file(s) directly.",
  preCheck({ args, session, report }) {
    const currentScope = extractSearchScope(args);
    for (const entry of scopedCallLog(session)) {
      if (entry.toolName !== "find-files") continue;
      const priorPatterns = extractFindPatterns(entry.args);
      const priorScope = extractSearchScope(entry.args);
      const sameScope = sameArray(priorScope, currentScope);
      const narrowingScope = isWorkspaceScope(priorScope) && !isWorkspaceScope(currentScope);
      if (!sameScope && !narrowingScope) continue;
      if (includesUniversalFindPattern(priorPatterns)) {
        report("blocked", "covered-by-universal-find");
        throw new Error("Redundant find-files call detected. Prior universal find already covers this scope.");
      }
    }
  },
});

const redundantVerifyGuard: ToolGuard = {
  id: "redundant-verify",
  description: "Block redundant verify runs when no writes happened since the last one.",
  tools: ["run-command"],
  check({ args, session, report }) {
    if (session.mode !== "verify") return;
    const command = typeof args.command === "string" ? args.command.trim().toLowerCase().replace(/\s+/g, " ") : "";
    if (!command) return;

    const calls = scopedCallLog(session);
    const lastMatchingVerifyRunIndex = (() => {
      for (let i = calls.length - 1; i >= 0; i -= 1) {
        const entry = calls[i];
        if (entry?.toolName !== "run-command" || entry.mode !== "verify") continue;
        const priorCommand =
          typeof entry.args.command === "string" ? entry.args.command.trim().toLowerCase().replace(/\s+/g, " ") : "";
        if (priorCommand === command) return i;
      }
      return -1;
    })();

    if (lastMatchingVerifyRunIndex < 0) return;

    let wroteAfterLastVerify = false;
    for (let i = lastMatchingVerifyRunIndex + 1; i < calls.length; i += 1) {
      const tool = calls[i]?.toolName;
      if (tool && isWriteTool(session, tool)) {
        wroteAfterLastVerify = true;
        break;
      }
    }
    if (!wroteAfterLastVerify) {
      report("blocked", "no-writes-since-last-verify");
      throw new Error("verify already ran this turn and no writes happened since; avoid redundant verify reruns.");
    }
  },
};

const postEditRedundancyGuard: ToolGuard = {
  id: "post-edit-redundancy",
  description: "Block redundant follow-up actions on files already edited in this task.",
  tools: ["delete-file"],
  check({ args, session, report }) {
    const targetPaths = Array.isArray(args.paths)
      ? args.paths
          .filter((value): value is string => typeof value === "string")
          .map((value) => normalizePath(value.trim().toLowerCase()))
          .filter((value) => value.length > 0)
      : [];
    if (targetPaths.length === 0) return;
    const editedPaths = editedPathsSinceLastVerify(session).map((entry) => normalizePath(entry.toLowerCase()));
    for (const path of targetPaths) {
      if (path !== "__edited_workspace__" && !editedPaths.includes(path)) continue;
      if (path === "__edited_workspace__" && editedPaths.length === 0) continue;
      report("blocked", path);
      throw new Error(
        `delete-file is trying to remove "${path}" after it was already edited in this task. ` +
          "Keep the file and revise it in place instead of deleting it.",
      );
    }
  },
};

const postEditDiscoveryGuard: ToolGuard = {
  id: "post-edit-discovery",
  description: "Block rediscovery on the same file after a bounded single-file edit.",
  tools: ["read-file", "search-files", "git-diff"],
  check({ toolName, args, session, report }) {
    const editedPath = singleEditedPathSinceLastVerify(session);
    if (!editedPath) return;

    if (toolName === "read-file") {
      const rawPaths = Array.isArray(args.paths) ? args.paths : [];
      if (rawPaths.length !== 1) return;
      const entry = rawPaths[0];
      if (!entry || typeof entry !== "object") return;
      const pathValue = (entry as { path?: unknown }).path;
      const start = (entry as { start?: unknown }).start;
      const end = (entry as { end?: unknown }).end;
      if (typeof pathValue !== "string") return;
      const readPath = normalizePath(pathValue.trim()).toLowerCase();
      if (readPath !== editedPath) return;
      if (typeof start === "number" || typeof end === "number") return;
      report("blocked", editedPath);
      throw new Error(
        `File "${editedPath}" was already edited in this task. Do not re-read the same file; ` +
          "use the diff you already have or run verify.",
      );
    }

    const scope = extractSearchScope(args);
    if (toolName === "git-diff") {
      const pathValue = typeof args.path === "string" ? normalizePath(args.path.trim()).toLowerCase() : "";
      if (pathValue !== editedPath) return;
      report("blocked", editedPath);
      throw new Error(
        `File "${editedPath}" was already edited in this task. Do not diff the same file again; ` +
          "use the edit preview you already have or run verify.",
      );
    }

    if (scope.length !== 1 || scope[0] !== editedPath) return;
    report("blocked", editedPath);
    throw new Error(
      `File "${editedPath}" was already edited in this task. Do not search the same file again; ` +
        "use the diff you already have or run verify.",
    );
  },
};

const sequentialSameFileEditGuard: ToolGuard = {
  id: "sequential-same-file-edit",
  description: "Block back-to-back write calls on the same file without new evidence.",
  tools: ["edit-file", "edit-code"],
  check({ toolName, args, session, report }) {
    const pathValue = typeof args.path === "string" ? normalizePath(args.path.trim()).toLowerCase() : "";
    if (!pathValue) return;

    const calls = scopedCallLog(session);
    const lastCall = calls[calls.length - 1];
    if (!lastCall) return;
    const lastPath =
      typeof lastCall.args.path === "string" ? normalizePath(lastCall.args.path.trim()).toLowerCase() : "";
    if (lastCall.success !== false && isWriteTool(session, lastCall.toolName) && lastPath === pathValue) {
      report("blocked", pathValue);
      throw new Error(
        `File "${pathValue}" was just edited. Batch same-file changes into one edit call unless you gather new evidence first.`,
      );
    }

    let attemptsSinceEvidence = 0;
    for (let index = calls.length - 1; index >= 0; index -= 1) {
      const entry = calls[index];
      if (!entry) break;
      if (entry.toolName === "read-file") {
        if (extractReadPaths(entry.args, { normalize: true }).includes(pathValue)) break;
        continue;
      }
      if (!isWriteTool(session, entry.toolName)) continue;
      const entryPath = typeof entry.args.path === "string" ? normalizePath(entry.args.path.trim()).toLowerCase() : "";
      if (entryPath !== pathValue) break;
      attemptsSinceEvidence += 1;
    }

    if (attemptsSinceEvidence < 2) return;

    report("blocked", `${pathValue}:${attemptsSinceEvidence}`);
    throw new Error(
      `File "${pathValue}" has already had ${attemptsSinceEvidence} edit attempts without a fresh reread. ` +
        "Read the file again or change strategy before trying another same-file edit.",
    );
  },
};

const stepBudgetGuard: ToolGuard = {
  id: "step-budget",
  description: "Enforce per-cycle and total step limits.",
  check({ session, report }) {
    const cycleLimit = session.flags.cycleStepLimit ?? DEFAULT_CYCLE_STEP_LIMIT;
    const cycleCount = session.flags.cycleStepCount ?? 0;
    const totalLimit = session.flags.totalStepLimit ?? DEFAULT_TOTAL_STEP_LIMIT;
    const totalCount = session.callLog.length;

    if (totalCount >= totalLimit) {
      report("blocked", "total-limit");
      throw new Error(`Total step budget exhausted (${totalLimit} tool calls). Commit what you have.`);
    }
    if (cycleCount >= cycleLimit) {
      report("blocked", "cycle-limit");
      throw new Error(`Cycle step budget exhausted (${cycleLimit} tool calls). Wrap up current phase.`);
    }
    session.flags.cycleStepCount = cycleCount + 1;
  },
};

export function resetCycleStepCount(session: SessionContext, limit?: number): void {
  session.flags.cycleStepCount = 0;
  if (limit !== undefined) session.flags.cycleStepLimit = limit;
}

const PING_PONG_WINDOW = 8;
const PING_PONG_MIN_ALTERNATIONS = 2;

const pingPongGuard: ToolGuard = {
  id: "ping-pong",
  description: "Block alternating tool call patterns that indicate the model is stuck.",
  check({ toolName, args, session, report }) {
    const calls = scopedCallLog(session);
    // Filter to non-write-tool calls only — write tools are expected between read ops
    const readCalls = calls.filter((c) => !isWriteTool(session, c.toolName));
    if (readCalls.length < 3) return;

    const window = readCalls.slice(-(PING_PONG_WINDOW - 1));
    const lastCall = window[window.length - 1];
    if (!lastCall || lastCall.toolName === toolName) return;

    const otherTool = lastCall.toolName;
    const otherArgs = lastCall.args;
    let alternations = 0;

    for (let i = window.length - 1; i >= 1; i -= 2) {
      const expectOther = window[i];
      const expectCurrent = window[i - 1];
      if (!expectOther || expectOther.toolName !== otherTool || !guardArgsEqual(expectOther.args, otherArgs)) break;
      if (!expectCurrent || expectCurrent.toolName !== toolName || !guardArgsEqual(expectCurrent.args, args)) break;
      alternations++;
    }

    if (alternations >= PING_PONG_MIN_ALTERNATIONS) {
      report("blocked", `${toolName}<->${otherTool}`);
      throw new Error(
        `Ping-pong loop detected: alternating between ${toolName} and ${otherTool} with unchanged arguments. ` +
          "Break the cycle by trying a different approach or different arguments.",
      );
    }
  },
};

const STALE_RESULT_THRESHOLD = 3;

const staleResultGuard: ToolGuard = {
  id: "stale-result",
  description: "Block tool calls that repeatedly return the same result, indicating no progress.",
  check({ toolName, args, session, report }) {
    if (isWriteTool(session, toolName)) return;

    const calls = scopedCallLog(session);
    let sameResultStreak = 0;
    let lastHash: string | undefined;

    for (let i = calls.length - 1; i >= 0; i--) {
      const entry = calls[i];
      if (!entry) break;
      if (entry.toolName !== toolName) continue;
      if (!guardArgsEqual(entry.args, args)) break;
      // Skip entries with no hash (result too large or unavailable) — can't compare
      if (!entry.resultHash) continue;

      if (lastHash === undefined) {
        lastHash = entry.resultHash;
        sameResultStreak = 1;
      } else if (entry.resultHash === lastHash) {
        sameResultStreak++;
      } else {
        break;
      }
    }

    if (sameResultStreak >= STALE_RESULT_THRESHOLD) {
      report("blocked", `${toolName}:${sameResultStreak}-same-results`);
      throw new Error(
        `${toolName} has returned the same result ${sameResultStreak} times with these arguments. ` +
          "The state has not changed. Try a different approach or different arguments.",
      );
    }
  },
};

const circuitBreakerGuard: ToolGuard = {
  id: "circuit-breaker",
  description: "Stop the model after too many consecutive guard blocks.",
  check({ session, report }) {
    const consecutiveBlocks = session.flags.consecutiveBlocks ?? 0;
    const blockLimit = session.flags.consecutiveGuardBlockLimit;
    invariant(
      typeof blockLimit === "number" && Number.isFinite(blockLimit) && blockLimit >= 1,
      "session.flags.consecutiveGuardBlockLimit must be a positive number",
    );
    if (consecutiveBlocks >= blockLimit) {
      report("blocked", `${consecutiveBlocks}-consecutive`);
      throw new Error(
        `${consecutiveBlocks} consecutive tool calls have been blocked. ` +
          "Stop and tell the user what you are trying to do.",
      );
    }
  },
};

const GUARDS: ToolGuard[] = [
  circuitBreakerGuard,
  stepBudgetGuard,
  duplicateCallGuard,
  pingPongGuard,
  staleResultGuard,
  fileChurnGuard,
  redundantFindGuard,
  redundantSearchGuard,
  redundantVerifyGuard,
  postEditRedundancyGuard,
  postEditDiscoveryGuard,
  sequentialSameFileEditGuard,
];

export function runGuards(input: Omit<GuardInput, "report">): void {
  for (const guard of GUARDS) {
    if (guard.tools && !guard.tools.includes(input.toolName)) continue;
    const report: GuardReport = (action, detail) => {
      input.session.onGuard?.({ guardId: guard.id, toolName: input.toolName, action, detail });
    };
    guard.check({ ...input, report });
  }
  // Any guard that throws increments consecutiveBlocks (in guardedExecute catch).
  // If we reach here, no guard blocked — reset the counter.
  input.session.flags.consecutiveBlocks = 0;
}

export function recordCall(
  session: SessionContext,
  toolName: string,
  args: Record<string, unknown>,
  resultHash?: string,
  success = true,
): void {
  session.callLog.push({ toolName, args, taskId: session.taskId, mode: session.mode, resultHash, success });
}
