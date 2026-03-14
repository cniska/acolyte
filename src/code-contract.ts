import { z } from "zod";

const editCodeScopeSchema = {
  within: z.string().min(1).optional(),
  withinSymbol: z.string().min(1).optional(),
};

export const editCodePatternEditSchema = z.object({
  op: z.literal("replace"),
  pattern: z.string().min(1),
  replacement: z.string(),
  ...editCodeScopeSchema,
});

export const editCodeRenameEditSchema = z.object({
  op: z.literal("rename"),
  from: z.string().min(1),
  to: z.string().min(1),
  ...editCodeScopeSchema,
});

export const editCodeEditSchema = z.discriminatedUnion("op", [editCodePatternEditSchema, editCodeRenameEditSchema]);

export type EditCodePatternEdit = z.infer<typeof editCodePatternEditSchema>;
export type EditCodeRenameEdit = z.infer<typeof editCodeRenameEditSchema>;
export type EditCodeEdit = z.infer<typeof editCodeEditSchema>;
