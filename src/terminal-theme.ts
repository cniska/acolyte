import { z } from "zod";

export const terminalStyleRoleSchema = z.enum([
  "plain",
  "muted",
  "user",
  "assistant",
  "assistant-code",
  "assistant-bold",
  "assistant-path",
  "tool",
  "tool-active",
  "pending",
  "pending-shimmer",
  "queued",
  "accepted",
  "success",
  "warning",
  "error",
  "cancelled",
  "diff-added",
  "diff-removed",
  "diff-gutter",
  "composer-border",
  "composer-prompt",
  "selected",
  "tool-label",
  "tool-meta-add",
  "tool-meta-remove",
  "header-brand",
  "header-mascot",
  "header-eyes",
  "cursor",
]);
export type TerminalStyleRole = z.infer<typeof terminalStyleRoleSchema>;

export const terminalStyleSchema = z.object({
  foreground: z.string().optional(),
  background: z.string().optional(),
  bold: z.boolean().optional(),
  dim: z.boolean().optional(),
  inverse: z.boolean().optional(),
});
export type TerminalStyle = z.infer<typeof terminalStyleSchema>;

export const terminalThemeSchema = z.object({ styles: z.record(terminalStyleRoleSchema, terminalStyleSchema) });
export type TerminalTheme = z.infer<typeof terminalThemeSchema>;

export const terminalTheme: TerminalTheme = Object.freeze({
  styles: {
    plain: {},
    muted: { foreground: "#8b949e" },
    user: { foreground: "#ffffff" },
    assistant: { foreground: "#ffffff" },
    "assistant-code": { foreground: "#ffffff", dim: true },
    "assistant-bold": { foreground: "#ffffff", bold: true },
    "assistant-path": { foreground: "#ffffff", dim: true },
    tool: { foreground: "#aaaaaa" },
    "tool-active": { foreground: "#d4a72c" },
    pending: { foreground: "#4DA3FF" },
    "pending-shimmer": { foreground: "#666666", dim: true },
    queued: { foreground: "#F5C451" },
    accepted: { foreground: "#4DD2FF" },
    success: { foreground: "#3fb950" },
    warning: { foreground: "#d29922" },
    error: { foreground: "#f85149" },
    cancelled: { foreground: "#E5A84B" },
    "diff-added": { foreground: "#e6ffec", background: "#1f6f3d" },
    "diff-removed": { foreground: "#ffdcd7", background: "#8b1e1e" },
    "diff-gutter": { foreground: "#8b949e" },
    "composer-border": { foreground: "#A56EFF", dim: true },
    "composer-prompt": {},
    selected: { foreground: "#A56EFF" },
    "tool-label": { bold: true },
    "tool-meta-add": { foreground: "#4a9a4a" },
    "tool-meta-remove": { foreground: "#9a4a4a" },
    "header-brand": { foreground: "#A56EFF" },
    "header-mascot": { foreground: "#2A1D4A" },
    "header-eyes": { foreground: "#FFD84D" },
    cursor: { inverse: true },
  },
});
