import { z } from "zod";

export const toolOutputDiffMarkerSchema = z.enum(["add", "remove", "context"]);

export const toolOutputPartSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("tool-header"),
    labelKey: z.string().trim().min(1),
    detail: z.string().optional(),
  }),
  z.object({ kind: z.literal("text"), text: z.string().trim().min(1) }),
  z.object({
    kind: z.literal("file-header"),
    labelKey: z.string().trim().min(1),
    count: z.number().int().nonnegative(),
    targets: z.array(z.string().trim().min(1)),
  }),
  z.object({
    kind: z.literal("scope-header"),
    labelKey: z.string().trim().min(1),
    scope: z.string().trim().min(1),
    patterns: z.array(z.string()),
    matches: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("edit-header"),
    labelKey: z.string().trim().min(1),
    path: z.string().trim().min(1),
    files: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("diff"),
    marker: toolOutputDiffMarkerSchema,
    lineNumber: z.number().int().positive(),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("shell-output"),
    stream: z.enum(["stdout", "stderr"]),
    text: z.string(),
  }),
  z.object({ kind: z.literal("no-output") }),
  z.object({
    kind: z.literal("truncated"),
    count: z.number().int().nonnegative().optional(),
    unit: z.string().optional(),
  }),
]);

export type ToolOutputPart = z.infer<typeof toolOutputPartSchema>;
