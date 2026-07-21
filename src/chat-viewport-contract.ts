import { z } from "zod";
import { transcriptRowSchema } from "./chat-transcript-contract";
import { pendingStateSchema } from "./client-contract";
import { inputControllerStateSchema } from "./input-controller";

export const headerPresentationSchema = z.object({
  title: z.string(),
  titleSuffix: z.string().optional(),
  version: z.string(),
  sessionId: z.string(),
});
export type HeaderPresentation = z.infer<typeof headerPresentationSchema>;

export const pendingPresentationSchema = z.object({
  state: pendingStateSchema,
  frame: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().nullable(),
  queuedMessages: z.array(z.string()),
  runningUsage: z
    .object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() })
    .nullable(),
});
export type PendingPresentation = z.infer<typeof pendingPresentationSchema>;

export const composerPickerItemSchema = z.object({ label: z.string(), value: z.string() });
export const composerPickerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("model"),
    query: z.string(),
    items: z.array(composerPickerItemSchema),
    selected: z.number().int().nonnegative(),
    scrollOffset: z.number().int().nonnegative(),
    hint: z.string(),
  }),
  z.object({
    kind: z.enum(["skills", "sessions"]),
    items: z.array(composerPickerItemSchema),
    selected: z.number().int().nonnegative(),
    scrollOffset: z.number().int().nonnegative(),
    hint: z.string(),
  }),
]);
export const composerSuggestionsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("at"),
    query: z.string(),
    candidates: z.array(z.object({ label: z.string(), value: z.string() })),
    selected: z.number().int().nonnegative(),
    noMatches: z.boolean(),
  }),
  z.object({
    kind: z.literal("slash"),
    candidates: z.array(z.object({ command: z.string(), help: z.string().optional() })),
    selected: z.number().int().nonnegative(),
    selectedHelp: z.string().optional(),
  }),
]);
export const composerHelpEntrySchema = z.object({ key: z.string(), description: z.string() });
export const composerStatusSegmentSchema = z.object({
  kind: z.enum(["repository", "branch", "model", "effort", "usage", "pull-request", "skills", "hint"]),
  text: z.string(),
  role: z.enum(["plain", "muted", "success", "warning", "error"]),
});
export const composerPresentationContractSchema = z.object({
  input: inputControllerStateSchema,
  placeholder: z.string(),
  focus: z.boolean(),
  caretVisible: z.boolean(),
  revision: z.number().int().nonnegative(),
  ctrlCPending: z.boolean(),
  prompt: z.enum(["chat", "picker"]),
  cursorLine: z.number().int().nonnegative(),
  activeIdentity: z.string().nullable(),
  picker: composerPickerSchema.nullable(),
  suggestions: composerSuggestionsSchema,
  showHelp: z.boolean(),
  helpEntries: z.array(composerHelpEntrySchema),
  helpBreakpoint: z.number().int().positive(),
  status: z.array(composerStatusSegmentSchema),
});
export type ComposerPresentationContract = z.infer<typeof composerPresentationContractSchema>;

export const viewportSectionKindSchema = z.enum(["header", "transcript", "pending", "checklist", "composer"]);
export const viewportSectionSchema = z.object({
  id: z.string().min(1),
  kind: viewportSectionKindSchema,
  finalized: z.boolean(),
});
export type ViewportSection = z.infer<typeof viewportSectionSchema>;
export const chatViewportPresentationSchema = z.object({
  header: headerPresentationSchema,
  transcript: z.array(transcriptRowSchema),
  pending: pendingPresentationSchema.nullable(),
  composer: composerPresentationContractSchema,
  sections: z.array(viewportSectionSchema),
});
export type ChatViewportPresentation = z.infer<typeof chatViewportPresentationSchema>;
