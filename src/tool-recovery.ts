export const TOOL_RECOVERY_NEXT_TOOLS = [
  "file-read",
  "file-find",
  "file-search",
  "file-edit",
  "code-scan",
  "code-edit",
] as const;
export type ToolRecoveryNextTool = (typeof TOOL_RECOVERY_NEXT_TOOLS)[number];
export type ToolRecoveryHints = {
  nextTool?: ToolRecoveryNextTool;
  targetPaths?: string[];
};
export type ToolRecoveryResolution = {
  tool: ToolRecoveryNextTool;
  targetPaths?: string[];
};

export type EditFileRecoveryKind = "disambiguate-match" | "refresh-snippet" | "shrink-edit";
export const EDIT_FILE_RECOVERY_KINDS: readonly EditFileRecoveryKind[] = [
  "disambiguate-match",
  "refresh-snippet",
  "shrink-edit",
];
export type EditFileRecovery = {
  tool: "file-edit";
  kind: EditFileRecoveryKind;
  summary: string;
  instruction: string;
  resolvesOn?: ToolRecoveryResolution[];
} & ToolRecoveryHints;

export type EditCodeRecoveryKind =
  | "clarify-rename-target"
  | "fix-replacement"
  | "refine-pattern"
  | "use-supported-file";
export const EDIT_CODE_RECOVERY_KINDS: readonly EditCodeRecoveryKind[] = [
  "clarify-rename-target",
  "fix-replacement",
  "refine-pattern",
  "use-supported-file",
];
export type EditCodeRecovery = {
  tool: "code-edit";
  kind: EditCodeRecoveryKind;
  summary: string;
  instruction: string;
  resolvesOn?: ToolRecoveryResolution[];
} & ToolRecoveryHints;

export type ScanCodeRecoveryKind = "use-supported-file";
export const SCAN_CODE_RECOVERY_KINDS: readonly ScanCodeRecoveryKind[] = ["use-supported-file"];
export type ScanCodeRecovery = {
  tool: "code-scan";
  kind: ScanCodeRecoveryKind;
  summary: string;
  instruction: string;
  resolvesOn?: ToolRecoveryResolution[];
} & ToolRecoveryHints;

export type SearchFilesRecoveryKind = "broaden-scope" | "switch-to-read";
export const SEARCH_FILES_RECOVERY_KINDS: readonly SearchFilesRecoveryKind[] = ["broaden-scope", "switch-to-read"];
export type SearchFilesRecovery = {
  tool: "file-search";
  kind: SearchFilesRecoveryKind;
  summary: string;
  instruction: string;
  resolvesOn?: ToolRecoveryResolution[];
} & ToolRecoveryHints;

export type ToolRecovery = EditFileRecovery | EditCodeRecovery | ScanCodeRecovery | SearchFilesRecovery;

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
  const resolvesOn = parseToolRecoveryResolutions(rec);
  if (rec.tool === "file-edit" && EDIT_FILE_RECOVERY_KINDS.includes(rec.kind as EditFileRecoveryKind))
    return {
      tool: rec.tool,
      kind: rec.kind as EditFileRecoveryKind,
      summary: rec.summary,
      instruction: rec.instruction,
      ...hints,
      ...(resolvesOn.length > 0 ? { resolvesOn } : {}),
    };
  if (rec.tool === "code-edit" && EDIT_CODE_RECOVERY_KINDS.includes(rec.kind as EditCodeRecoveryKind))
    return {
      tool: rec.tool,
      kind: rec.kind as EditCodeRecoveryKind,
      summary: rec.summary,
      instruction: rec.instruction,
      ...hints,
      ...(resolvesOn.length > 0 ? { resolvesOn } : {}),
    };
  if (rec.tool === "code-scan" && SCAN_CODE_RECOVERY_KINDS.includes(rec.kind as ScanCodeRecoveryKind))
    return {
      tool: rec.tool,
      kind: rec.kind as ScanCodeRecoveryKind,
      summary: rec.summary,
      instruction: rec.instruction,
      ...hints,
      ...(resolvesOn.length > 0 ? { resolvesOn } : {}),
    };
  if (rec.tool === "file-search" && SEARCH_FILES_RECOVERY_KINDS.includes(rec.kind as SearchFilesRecoveryKind))
    return {
      tool: rec.tool,
      kind: rec.kind as SearchFilesRecoveryKind,
      summary: rec.summary,
      instruction: rec.instruction,
      ...hints,
      ...(resolvesOn.length > 0 ? { resolvesOn } : {}),
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

function parseToolRecoveryResolutions(rec: Record<string, unknown>): ToolRecoveryResolution[] {
  if (!Array.isArray(rec.resolvesOn)) return [];
  return rec.resolvesOn.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const resolution = value as Record<string, unknown>;
    if (
      typeof resolution.tool !== "string" ||
      !TOOL_RECOVERY_NEXT_TOOLS.includes(resolution.tool as ToolRecoveryNextTool)
    ) {
      return [];
    }
    const targetPaths = Array.isArray(resolution.targetPaths)
      ? resolution.targetPaths.filter((path): path is string => typeof path === "string" && path.trim().length > 0)
      : undefined;
    return [
      {
        tool: resolution.tool as ToolRecoveryNextTool,
        ...(targetPaths && targetPaths.length > 0 ? { targetPaths } : {}),
      },
    ];
  });
}
