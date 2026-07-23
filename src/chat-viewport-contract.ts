import { z } from "zod";
import { transcriptRowSchema } from "./chat-transcript-contract";
import { pendingStateSchema } from "./client-contract";
import { footerStatusSchema } from "./footer-status-contract";
import { inputControllerStateSchema } from "./input-controller";
import { skillMetaSchema } from "./skill-contract";

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

export const composerPickerItemSchema = z.object({
  label: z.string(),
  value: z.string(),
  detail: z.string().optional(),
  active: z.boolean().optional(),
  source: z.enum(["bundled", "project"]).optional(),
});
export const composerPickerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("model"),
    input: inputControllerStateSchema,
    items: z.array(composerPickerItemSchema),
    selected: z.number().int().nonnegative(),
    scrollOffset: z.number().int().nonnegative(),
    hint: z.string(),
    loading: z.boolean().optional(),
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
  }),
]);
export const composerHelpEntrySchema = z.object({ key: z.string(), description: z.string() });
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
});
export type ComposerPresentationContract = z.infer<typeof composerPresentationContractSchema>;

export const viewportSectionKindSchema = z.enum(["header", "transcript", "pending", "tasklist", "composer"]);
export const viewportSectionSchema = z.object({
  id: z.string().min(1),
  kind: viewportSectionKindSchema,
  finalized: z.boolean(),
});
export type ViewportSection = z.infer<typeof viewportSectionSchema>;

export const viewportPickerInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("model"),
    input: inputControllerStateSchema,
    items: z.array(z.object({ label: z.string(), value: z.string() })),
    selected: z.number().int().nonnegative(),
    scrollOffset: z.number().int().nonnegative(),
    loading: z.boolean(),
  }),
  z.object({
    kind: z.literal("skills"),
    items: z.array(skillMetaSchema),
    selected: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("sessions"),
    items: z.array(z.object({ id: z.string(), title: z.string(), updatedAt: z.string() })),
    selected: z.number().int().nonnegative(),
    scrollOffset: z.number().int().nonnegative(),
    activeSessionId: z.string().nullable(),
  }),
]);
export type ViewportPickerInput = z.infer<typeof viewportPickerInputSchema>;

export const viewportSuggestionsInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("at"),
    query: z.string(),
    candidates: z.array(z.string()),
    selected: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("slash"),
    candidates: z.array(z.string()),
    selected: z.number().int().nonnegative(),
  }),
]);
export type ViewportSuggestionsInput = z.infer<typeof viewportSuggestionsInputSchema>;

export const chatViewportPresentationInputSchema = z.object({
  header: headerPresentationSchema,
  activeTranscript: z.array(transcriptRowSchema),
  pending: pendingPresentationSchema.nullable(),
  composer: z.object({
    input: inputControllerStateSchema,
    picker: viewportPickerInputSchema.nullable(),
    suggestions: viewportSuggestionsInputSchema,
    help: z.object({
      visible: z.boolean(),
      entries: z.array(z.object({ key: z.string(), description: z.string() })).readonly(),
    }),
    ctrlCPending: z.boolean(),
    footer: footerStatusSchema,
  }),
});
export type ChatViewportPresentationInput = z.infer<typeof chatViewportPresentationInputSchema>;

export const chatViewportPresentationSchema = z.object({
  header: headerPresentationSchema,
  transcript: z.array(transcriptRowSchema),
  pending: pendingPresentationSchema.nullable(),
  composer: composerPresentationContractSchema,
  footer: footerStatusSchema.optional(),
  sections: z.array(viewportSectionSchema),
});
export type ChatViewportPresentation = z.infer<typeof chatViewportPresentationSchema>;
