import { stat } from "node:fs/promises";
import type { PostToolContext, PreToolContext, SessionContext } from "./tool-session";
import { captureUndoBefore, commitUndoCheckpoint } from "./undo-checkpoints";
import { ensurePathWithinSandbox } from "./workspace-sandbox";

function collectUndoPathsFromToolArgs(
  toolId: string,
  args: Record<string, unknown>,
): { paths: string[]; needsFileCheck: boolean } {
  const paths: string[] = [];
  let needsFileCheck = false;
  if (toolId === "file-edit" || toolId === "file-create") {
    const p = typeof args.path === "string" ? args.path.trim() : "";
    if (p) paths.push(p);
  } else if (toolId === "file-delete") {
    const ps = args.paths;
    if (Array.isArray(ps)) {
      for (const p of ps) if (typeof p === "string" && p.trim().length > 0) paths.push(p.trim());
    }
  } else if (toolId === "code-edit") {
    const p = typeof args.path === "string" ? args.path.trim() : "";
    if (p) {
      paths.push(p);
      needsFileCheck = true;
    }
  }
  return { paths, needsFileCheck };
}

async function isFilePath(workspace: string, pathInput: string): Promise<boolean> {
  try {
    const abs = ensurePathWithinSandbox(pathInput, workspace);
    const s = await stat(abs);
    return s.isFile();
  } catch {
    return false;
  }
}

export function attachUndoCheckpointSideEffects(options: {
  workspace: string;
  sessionId: string;
  session: SessionContext;
  writeToolSet: ReadonlySet<string>;
}): void {
  const pendingUndo = new Map<string, Awaited<ReturnType<typeof captureUndoBefore>>>();

  const prevBeforeAsync = options.session.onBeforeToolAsync;
  options.session.onBeforeToolAsync = async (preCtx: PreToolContext) => {
    await prevBeforeAsync?.(preCtx);
    if (!options.writeToolSet.has(preCtx.toolId)) return;

    const { paths, needsFileCheck } = collectUndoPathsFromToolArgs(preCtx.toolId, preCtx.args);
    if (paths.length === 0) return;

    if (needsFileCheck) {
      const filtered: string[] = [];
      for (const p of paths) {
        if (await isFilePath(options.workspace, p)) filtered.push(p);
      }
      if (filtered.length === 0) return;
      paths.splice(0, paths.length, ...filtered);
    }

    const capture = await captureUndoBefore({
      workspace: options.workspace,
      toolCallId: preCtx.toolCallId,
      toolId: preCtx.toolId,
      paths,
    });
    pendingUndo.set(preCtx.toolCallId, capture);
  };

  const prevAfterAsync = options.session.onAfterToolAsync;
  options.session.onAfterToolAsync = async (postCtx: PostToolContext) => {
    await prevAfterAsync?.(postCtx);
    if (!options.writeToolSet.has(postCtx.toolId)) return;

    const pending = pendingUndo.get(postCtx.toolCallId);
    if (!pending) return;
    pendingUndo.delete(postCtx.toolCallId);
    if (postCtx.status !== "succeeded") return;
    await commitUndoCheckpoint({ workspace: options.workspace, sessionId: options.sessionId, pending });
  };
}
