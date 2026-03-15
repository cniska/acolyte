import {
  EDIT_CODE_RECOVERY_KINDS,
  EDIT_FILE_RECOVERY_KINDS,
  type EditCodeRecoveryKind,
  type EditFileRecoveryKind,
  SCAN_CODE_RECOVERY_KINDS,
  type ScanCodeRecoveryKind,
  TOOL_RECOVERY_NEXT_TOOLS,
  type ToolRecovery,
  type ToolRecoveryHints,
  type ToolRecoveryNextTool,
} from "./error-primitives";

export function parseToolRecovery(value: unknown): ToolRecovery | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  if (
    typeof rec.tool !== "string" ||
    typeof rec.kind !== "string" ||
    typeof rec.summary !== "string" ||
    typeof rec.instruction !== "string"
  ) {
    return undefined;
  }
  const hints = parseToolRecoveryHints(rec);
  if (rec.tool === "edit-file" && EDIT_FILE_RECOVERY_KINDS.includes(rec.kind as EditFileRecoveryKind))
    return {
      tool: rec.tool,
      kind: rec.kind as EditFileRecoveryKind,
      summary: rec.summary,
      instruction: rec.instruction,
      ...hints,
    };
  if (rec.tool === "edit-code" && EDIT_CODE_RECOVERY_KINDS.includes(rec.kind as EditCodeRecoveryKind))
    return {
      tool: rec.tool,
      kind: rec.kind as EditCodeRecoveryKind,
      summary: rec.summary,
      instruction: rec.instruction,
      ...hints,
    };
  if (rec.tool === "scan-code" && SCAN_CODE_RECOVERY_KINDS.includes(rec.kind as ScanCodeRecoveryKind))
    return {
      tool: rec.tool,
      kind: rec.kind as ScanCodeRecoveryKind,
      summary: rec.summary,
      instruction: rec.instruction,
      ...hints,
    };
  return undefined;
}

function parseToolRecoveryHints(rec: Record<string, unknown>): ToolRecoveryHints {
  const nextTool: ToolRecoveryNextTool | undefined =
    typeof rec.nextTool === "string" && TOOL_RECOVERY_NEXT_TOOLS.includes(rec.nextTool as ToolRecoveryNextTool)
      ? (rec.nextTool as ToolRecoveryNextTool)
      : undefined;
  const targetPaths = Array.isArray(rec.targetPaths)
    ? rec.targetPaths.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : undefined;
  return {
    ...(nextTool ? { nextTool } : {}),
    ...(targetPaths && targetPaths.length > 0 ? { targetPaths } : {}),
  };
}
