export type GuardEvent = { guardId: string; toolName: string; action: "blocked" | "flag_set"; detail?: string };

export type SessionContext = {
  callLog: Array<{ toolName: string; args: Record<string, unknown> }>;
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
  check: (input: GuardInput) => void;
};

export function createSessionContext(): SessionContext {
  return { callLog: [], flags: {} };
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
    if (typeof path === "string" && path.trim().length > 0) {
      out.push(normalizePath(path.trim()));
    }
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
  check({ toolName, args, session }) {
    if (toolName !== "delete-file") return;
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
  check({ toolName, args, session }) {
    if (toolName !== "read-file" && toolName !== "edit-file") return;

    const targetPaths =
      toolName === "edit-file"
        ? typeof args.path === "string" && args.path.trim().length > 0
          ? [normalizePath(args.path.trim())]
          : []
        : extractReadPaths(args);
    if (targetPaths.length !== 1) return;
    const target = targetPaths[0];

    let readCount = 0;
    let editCount = 0;
    for (const entry of session.callLog) {
      if (entry.toolName === "read-file") {
        const hasTarget = extractReadPaths(entry.args).some((path) => path === target);
        if (hasTarget) readCount += 1;
      } else if (entry.toolName === "edit-file") {
        const path = entry.args.path;
        if (typeof path === "string" && normalizePath(path) === target) {
          editCount += 1;
        }
      }
    }

    const combined = readCount + editCount;
    if (combined < 12 || readCount < 5 || editCount < 5) return;

    session.onGuard?.({ guardId: "excessive-file-loop", toolName, action: "blocked", detail: target });
    throw new Error(
      `Repeated read/edit loop detected for "${target}". Stop incremental tweaks. ` +
        "Use one consolidated edit (line-range block or edit-code), then run verify.",
    );
  },
};

const verifyRanGuard: ToolGuard = {
  id: "verify-ran",
  description: "Set session flag when run-command executes a verify command.",
  check({ toolName, args, session }) {
    if (toolName !== "run-command") return;
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
  check({ toolName, args, session }) {
    if (toolName !== "run-command") return;
    const command = typeof args.command === "string" ? args.command : "";
    if (!isShellReadFallback(command)) return;
    session.onGuard?.({ guardId: "no-shell-read-fallback", toolName, action: "blocked", detail: command });
    throw new Error(
      "Do not use shell commands for file reading/searching. Use read-file, find-files, or search-files instead.",
    );
  },
};

const GUARDS: ToolGuard[] = [noRewriteGuard, excessiveFileLoopGuard, verifyRanGuard, noShellReadFallbackGuard];

export function runGuards(input: GuardInput): void {
  for (const guard of GUARDS) {
    guard.check(input);
  }
}

export function recordCall(session: SessionContext, toolName: string, args: Record<string, unknown>): void {
  session.callLog.push({ toolName, args });
}
