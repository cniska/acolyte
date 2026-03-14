import { z } from "zod";

const editCodeScopeSchema = {
  within: z.string().min(1).optional(),
  withinSymbol: z.string().min(1).optional(),
};

const editCodePatternStrictnessSchema = z.enum(["cst", "smart", "ast", "relaxed", "signature"]);

export const editCodePatternObjectSchema = z.object({
  context: z.string().min(1),
  selector: z.string().min(1).optional(),
  strictness: editCodePatternStrictnessSchema.optional(),
});

export const editCodePatternSchema = z.union([z.string().min(1), editCodePatternObjectSchema]);

export const editCodePatternEditSchema = z.object({
  op: z.literal("replace"),
  pattern: editCodePatternSchema,
  replacement: z.string(),
  kind: z.string().min(1).optional(),
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
export type EditCodePattern = z.infer<typeof editCodePatternSchema>;
