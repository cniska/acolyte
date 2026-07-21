import { z } from "zod";
import { transcriptRowSchema } from "./chat-transcript-contract";
import { pendingStateSchema } from "./client-contract";
import { inputControllerStateSchema } from "./input-controller";

export const headerPresentationSchema = z.object({
  title: z.string(),
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

export const composerPresentationContractSchema = z.object({
  input: inputControllerStateSchema,
  placeholder: z.string(),
  picker: z
    .object({
      kind: z.string(),
      query: z.string(),
      items: z.array(z.string()),
      selected: z.number().int().nonnegative(),
    })
    .nullable(),
  suggestions: z.array(z.string()),
  showHelp: z.boolean(),
  status: z.object({ text: z.string() }).nullable(),
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
