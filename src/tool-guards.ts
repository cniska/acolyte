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

function isShellReadFallback(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed.length === 0) return false;
  const normalized = trimmed.replace(/\s+/g, " ").toLowerCase();
  const disallowed = /\b(cat|sed|head|tail|nl|wc|ls|find|grep|rg)\b/;
  if (!disallowed.test(normalized)) return false;
  const allowedContext = /\b(verify|test|build|lint|format|check|ci|coverage|compile|start|dev|serve|run)\b/;
  return !allowedContext.test(normalized);
}

const noRewriteGuard: ToolGuard = {
  id: "no-rewrite",
  description: "Block delete-file on a path that was previously read — use edit-file instead.",
  appliesTo: ["delete-file"],
  check({ toolName, args, session }) {
    const deletePath = typeof args.path === "string" ? args.path : null;
    if (!deletePath) return;
    const normalized = normalizePath(deletePath);
    const wasRead = session.callLog.some((entry) => {
      if (entry.toolName !== "read-file") return false;
      const paths = entry.args.paths;
      if (!Array.isArray(paths)) return false;
      return (paths as Array<{ path?: string }>).some((p) => {
        if (typeof p.path !== "string") return false;
        const n = normalizePath(p.path);
        return n === normalized || n.endsWith(`/${normalized}`) || normalized.endsWith(`/${n}`);
      });
    });
    if (wasRead) {
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
    for (const entry of session.callLog) {
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
  check({ toolName, session }) {
    let searchCount = 0;
    let readCount = 0;
    let writeCount = 0;
    for (const entry of session.callLog) {
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

const verifyRanGuard: ToolGuard = {
  id: "verify-ran",
  description: "Set session flag when run-command executes a verify command.",
  appliesTo: ["run-command"],
  check({ toolName, args, session }) {
    if (typeof args.command !== "string") return;
    if (/\bverify\b/i.test(args.command)) {
      session.flags.verifyRan = true;
      session.onGuard?.({ guardId: "verify-ran", toolName, action: "flag_set", detail: "verifyRan" });
    }
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

const GUARDS: ToolGuard[] = [
  noRewriteGuard,
  excessiveFileLoopGuard,
  excessiveSearchLoopGuard,
  verifyRanGuard,
  noShellReadFallbackGuard,
];

export function runGuards(input: GuardInput): void {
  for (const guard of GUARDS) {
    if (guard.appliesTo !== "all" && !guard.appliesTo.includes(input.toolName)) continue;
    guard.check(input);
  }
}

export function recordCall(session: SessionContext, toolName: ToolName, args: Record<string, unknown>): void {
  session.callLog.push({ toolName, args, taskId: session.taskId });
}
