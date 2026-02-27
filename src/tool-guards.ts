export type SessionContext = {
  callLog: Array<{ toolName: string; args: Record<string, unknown> }>;
  flags: Record<string, unknown>;
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
      throw new Error(
        `Cannot delete "${deletePath}" — it was read this session. Use edit-file to modify it instead of deleting and recreating.`,
      );
    }
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
    }
  },
};

const GUARDS: ToolGuard[] = [noRewriteGuard, verifyRanGuard];

export function runGuards(input: GuardInput): void {
  for (const guard of GUARDS) {
    guard.check(input);
  }
}

export function recordCall(session: SessionContext, toolName: string, args: Record<string, unknown>): void {
  session.callLog.push({ toolName, args });
}
