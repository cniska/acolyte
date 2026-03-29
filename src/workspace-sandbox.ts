import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { ERROR_KINDS, TOOL_ERROR_CODES } from "./error-contract";
import { createToolError } from "./tool-error";

const sandboxRootCache = new Map<string, string>();
const SANDBOX_VIOLATION_MESSAGES = {
  unresolvedPath: "Sandbox violation: cannot resolve path within workspace sandbox",
  resolvedOutside: "Sandbox violation: path resolves outside workspace sandbox",
  outside: "Sandbox violation: path is outside workspace sandbox",
  pathTraversal: "Sandbox violation: command contains path traversal outside workspace sandbox",
  homePath: "Sandbox violation: command references home path outside workspace sandbox",
} as const;

type SandboxViolationMessageKey = keyof typeof SANDBOX_VIOLATION_MESSAGES;

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT"
  );
}

function pathEntryExists(pathInput: string): boolean {
  try {
    lstatSync(pathInput);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

function resolveExistingPath(pathInput: string): string {
  try {
    return realpathSync(pathInput);
  } catch (error) {
    if (isNotFoundError(error) && pathEntryExists(pathInput)) {
      throw sandboxViolationError("unresolvedPath");
    }
    throw error;
  }
}

function nearestExistingPath(pathInput: string): string {
  let current = pathInput;
  while (!pathEntryExists(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function isWithinSandboxRoot(targetPath: string, sandboxRoot: string): boolean {
  const rel = relative(sandboxRoot, targetPath);
  if (rel === "") return true;
  return !rel.startsWith("..") && !isAbsolute(rel);
}

export function resolveWorkspaceSandboxRoot(workspace: string): string {
  const resolvedWorkspace = resolve(workspace);
  const cached = sandboxRootCache.get(resolvedWorkspace);
  if (cached) return cached;

  const sandboxRoot = resolveExistingPath(resolvedWorkspace);
  sandboxRootCache.set(resolvedWorkspace, sandboxRoot);
  return sandboxRoot;
}

export function sandboxViolationError(messageKey: SandboxViolationMessageKey) {
  return createToolError(
    TOOL_ERROR_CODES.sandboxViolation,
    SANDBOX_VIOLATION_MESSAGES[messageKey],
    ERROR_KINDS.sandboxViolation,
  );
}

export function ensurePathWithinSandbox(pathInput: string, workspace: string): string {
  const sandboxRoot = resolveWorkspaceSandboxRoot(workspace);
  const absolutePath = resolve(workspace, pathInput);
  const pathExists = pathEntryExists(absolutePath);
  const boundaryPath = pathExists
    ? resolveExistingPath(absolutePath)
    : resolveExistingPath(nearestExistingPath(absolutePath));

  if (isWithinSandboxRoot(boundaryPath, sandboxRoot)) {
    return absolutePath;
  }

  throw sandboxViolationError(pathExists ? "resolvedOutside" : "outside");
}

export function clearWorkspaceSandboxCache(): void {
  sandboxRootCache.clear();
}
