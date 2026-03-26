import { invariant } from "./assert";
import { CONSECUTIVE_GUARD_BLOCK_LIMIT, TOOL_TIMEOUT_MS } from "./lifecycle-constants";
import {
  extractFindPatterns,
  extractReadPaths,
  extractSearchPatterns,
  extractSearchScope,
  includesUniversalFindPattern,
  normalizePath,
  WORKSPACE_SCOPE,
} from "./tool-arg-paths";
import type { ToolCache } from "./tool-contract";
import { formatWorkspaceCommand, type WorkspaceCommand, type WorkspaceProfile } from "./workspace-profile";

const DEFAULT_CYCLE_STEP_LIMIT = 80;
const DEFAULT_TOTAL_STEP_LIMIT = 200;

export type GuardEvent = {
  guardId: string;
  toolName: string;
  action: "blocked" | "flag_set";
  detail?: string;
};

export type ToolCallStatus = "succeeded" | "failed";

export type ToolCallRecord = {
  toolName: string;
  args: Record<string, unknown>;
  taskId?: string;
  mode?: string;
  resultHash?: string;
  status: ToolCallStatus;
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
  workspaceProfile?: WorkspaceProfile;
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
  for (let i = 0; i < a.length; i++) {
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
  return scope.length === 1 && scope[0] === WORKSPACE_SCOPE;
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
    if (entry.status === "failed") continue;
    if (!isWriteTool(session, entry.toolName)) continue;
    if (typeof entry.args.path !== "string") continue;
    const path = normalizePath(entry.args.path.trim().toLowerCase());
    if (path.length > 0) paths.add(path);
  }
  return Array.from(paths);
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

function readCountForPath(session: SessionContext, path: string): number {
  let count = 0;
  for (const entry of scopedCallLog(session)) {
    if (entry.toolName !== "read-file") continue;
    count += extractReadPaths(entry.args, { normalize: true }).filter((readPath) => readPath === path).length;
  }
  return count;
}

function searchTouchesPath(args: Record<string, unknown>, path: string): boolean {
  const scope = extractSearchScope(args);
  return scope.some((entry) => entry === path || entry === WORKSPACE_SCOPE);
}

function scanTouchesPath(args: Record<string, unknown>, path: string): boolean {
  const rawPaths = Array.isArray(args.paths) ? args.paths : [];
  return rawPaths.some((entry) => typeof entry === "string" && normalizePath(entry.trim().toLowerCase()) === path);
}

function hasFreshEvidenceSinceLastSuccessfulEdit(session: SessionContext, path: string): boolean {
  const calls = scopedCallLog(session);
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const entry = calls[i];
    if (!entry) continue;
    if (entry.toolName === "read-file" && extractReadPaths(entry.args, { normalize: true }).includes(path)) return true;
    if (entry.toolName === "search-files" && searchTouchesPath(entry.args, path)) return true;
    if (entry.toolName === "scan-code" && scanTouchesPath(entry.args, path)) return true;
    if (entry.status === "failed") continue;
    if (entry.toolName === "edit-file") {
      const editedPath = typeof entry.args.path === "string" ? normalizePath(entry.args.path.trim().toLowerCase()) : "";
      if (editedPath === path) return false;
    }
  }
  return true;
}

function guardArgsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(normalizeGuardArgValue(a)) === JSON.stringify(normalizeGuardArgValue(b));
}

const DUPLICATE_CALL_LOOKBACK = 3;

const duplicateCallGuard: ToolGuard = {
  id: "duplicate-call",
  description: "Block near-duplicate tool calls with no state-changing tool in between.",
  check({ args, toolName, session, report }) {
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

function hasReadSinceLastEditOf(callLog: ToolCallRecord[], session: SessionContext, path: string): boolean {
  for (let i = callLog.length - 1; i >= 0; i--) {
    const entry = callLog[i];
    if (!entry) continue;
    if (
      entry.status !== "failed" &&
      isWriteTool(session, entry.toolName) &&
      normalizePath(String(entry.args.path ?? "")) === path
    ) {
      return false;
    }
    if (entry.toolName === "read-file" && extractReadPaths(entry.args, { normalize: true }).includes(path)) {
      return true;
    }
  }
  return false;
}

const fileChurnGuard: ToolGuard = {
  id: "file-churn",
  description: "Block excessive read/edit churn on the same file to force a strategy change.",
  tools: ["read-file", "edit-file"],
  check({ args, session, toolName, report }) {
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
    const sinceLastVerify = callsSinceLastVerify(session);
    for (const entry of sinceLastVerify) {
      if (entry.toolName === "read-file") {
        for (const readPath of extractReadPaths(entry.args, { normalize: true })) {
          countsForPath(readPath).readCount += 1;
        }
      } else if (
        entry.status !== "failed" &&
        isWriteTool(session, entry.toolName) &&
        typeof entry.args.path === "string"
      ) {
        countsForPath(normalizePath(entry.args.path)).editCount += 1;
      }
    }

    for (const target of targetPaths) {
      const { readCount, editCount } = countsForPath(target);

      if (toolName === "read-file" && editCount > 0 && session.mode !== "verify") {
        if (hasReadSinceLastEditOf(sinceLastVerify, session, target)) {
          report("blocked", target);
          throw new Error(
            `File "${target}" was already re-read after the last edit. Use the content you already have.`,
          );
        }
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
          "Use one consolidated edit or edit-code, then run verify.",
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
    if (currentScope.length !== 1 || currentScope[0] === WORKSPACE_SCOPE) return;
    const targetPath = currentScope[0];
    if (!targetPath) return;

    for (const entry of scopedCallLog(session)) {
      if (entry.status !== "failed" && isWriteTool(session, entry.toolName)) return;
    }

    const calls = scopedCallLog(session);
    const prior = calls[calls.length - 1];
    if (!prior || prior.toolName !== "read-file") return;
    if (extractReadPaths(prior.args, { normalize: true }).includes(targetPath)) {
      report("blocked", targetPath);
      throw new Error(
        `File "${targetPath}" was already read directly in full. Do not search the same file before editing; ` +
          "use the text you already have to make the change.",
      );
    }

    if (readCountForPath(session, targetPath) < 2) return;

    report("blocked", `${targetPath}:repeat-read`);
    throw new Error(
      `File "${targetPath}" was already read multiple times in this task. Do not search the same file again; ` +
        "use the reads you already have or edit a bounded range directly.",
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
    for (let i = lastMatchingVerifyRunIndex + 1; i < calls.length; i++) {
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
  tools: ["delete-file", "edit-file"],
  check({ args, session, report, toolName }) {
    if (toolName === "edit-file") {
      const targetPath = typeof args.path === "string" ? normalizePath(args.path.trim().toLowerCase()) : "";
      if (!targetPath || hasFreshEvidenceSinceLastSuccessfulEdit(session, targetPath)) return;
      report("blocked", targetPath);
      throw new Error(
        `File "${targetPath}" was already edited successfully in this task, and there is no new file evidence for another edit. ` +
          "Use the diff you already have or read the file again before another edit.",
      );
    }

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

const GIT_WRITE_COMMANDS: { pattern: RegExp; tool: string }[] = [
  { pattern: /\bgit\s+add\b/, tool: "git-add" },
  { pattern: /\bgit\s+commit\b/, tool: "git-commit" },
  { pattern: /\bgit\s+push\b/, tool: "git push is not available" },
  { pattern: /\bgit\s+reset\b/, tool: "git reset is not available" },
  { pattern: /\bgit\s+rebase\b/, tool: "git rebase is not available" },
  { pattern: /\bgit\s+merge\b/, tool: "git merge is not available" },
  { pattern: /\bgit\s+checkout\b/, tool: "git checkout is not available" },
  { pattern: /\bgit\s+restore\b/, tool: "git restore is not available" },
  { pattern: /\bgit\s+clean\b/, tool: "git clean is not available" },
  { pattern: /\bgit\s+stash\b/, tool: "git stash is not available" },
];

const shellBypassGuard: ToolGuard = {
  id: "shell-bypass",
  description: "Block shell commands that bypass dedicated tools.",
  tools: ["run-command"],
  check({ args, report }) {
    const command = typeof args.command === "string" ? args.command : "";
    if (!command) return;
    for (const { pattern, tool } of GIT_WRITE_COMMANDS) {
      if (pattern.test(command)) {
        report("blocked", tool);
        throw new Error(`This git operation is blocked via run-command. Use the dedicated ${tool} tool instead.`);
      }
    }
  },
};

function commandMatchesProfile(command: string, profile: WorkspaceProfile): boolean {
  const commands = [profile.lintCommand, profile.formatCommand]
    .filter((cmd): cmd is WorkspaceCommand => cmd !== undefined)
    .map((cmd) => formatWorkspaceCommand(cmd));
  return commands.some((cmd) => command.includes(cmd));
}

function commandMatchesTestRunner(command: string, profile: WorkspaceProfile): boolean {
  if (!profile.testCommand) return false;
  const baseCommand = formatWorkspaceCommand(profile.testCommand).replace("$FILES", "").trim();
  return command.includes(baseCommand);
}

const lifecycleCommandGuard: ToolGuard = {
  id: "lifecycle-command",
  description: "Block lint/format/test commands — use dedicated tools or let the lifecycle handle them.",
  tools: ["run-command"],
  check({ args, session, report }) {
    const profile = session.workspaceProfile;
    if (!profile) return;
    const command = typeof args.command === "string" ? args.command : "";
    if (!command) return;
    if (commandMatchesProfile(command, profile)) {
      report("blocked", command);
      throw new Error("Lint and format commands run automatically after your edits. Do not run them manually.");
    }
    if (commandMatchesTestRunner(command, profile)) {
      report("blocked", command);
      throw new Error("Use the run-tests tool instead of running test commands directly.");
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
  shellBypassGuard,
  lifecycleCommandGuard,
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
  status: ToolCallStatus = "succeeded",
): void {
  session.callLog.push({ toolName, args, taskId: session.taskId, mode: session.mode, resultHash, status });
}
