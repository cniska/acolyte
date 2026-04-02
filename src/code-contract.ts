import { z } from "zod";

const editCodeScopeSchema = {
  within: z.string().min(1).optional(),
  withinSymbol: z.string().min(1).optional(),
  scope: z.literal("workspace").optional(),
};

export const editCodeRenameTargetSchema = z.enum(["local", "member"]);
const editCodePatternStrictnessSchema = z.enum(["cst", "smart", "ast", "relaxed", "signature"]);
const editCodeRelationalStopByKeywordSchema = z.enum(["neighbor", "end"]);

export const editCodePatternObjectSchema = z.object({
  context: z.string().min(1),
  selector: z.string().min(1).optional(),
  strictness: editCodePatternStrictnessSchema.optional(),
});

export const editCodePatternSchema = z.union([z.string().min(1), editCodePatternObjectSchema]);

export type EditCodePattern = z.infer<typeof editCodePatternSchema>;

export type EditCodeRuleObject = {
  pattern?: EditCodePattern;
  kind?: string;
  regex?: string;
  inside?: EditCodeRelationalRule;
  has?: EditCodeRelationalRule;
  all?: EditCodeRule[];
  any?: EditCodeRule[];
  not?: EditCodeRule;
};

export type EditCodeRule = EditCodePattern | EditCodeRuleObject;
export type EditCodeRelationalStopBy = z.infer<typeof editCodeRelationalStopByKeywordSchema> | EditCodeRule;
export type EditCodeRelationalRule = EditCodeRuleObject & {
  field?: string;
  stopBy?: EditCodeRelationalStopBy;
};

function createEditCodeRuleSchema(): z.ZodType<EditCodeRule> {
  let ruleSchema!: z.ZodType<EditCodeRule>;
  let relationalRuleSchema!: z.ZodType<EditCodeRelationalRule>;
  const createRuleObjectSchema = () =>
    z
      .object({
        pattern: editCodePatternSchema.optional(),
        kind: z.string().min(1).optional(),
        regex: z.string().min(1).optional(),
        inside: relationalRuleSchema.optional(),
        has: relationalRuleSchema.optional(),
        all: z.array(ruleSchema).min(1).optional(),
        any: z.array(ruleSchema).min(1).optional(),
        not: ruleSchema.optional(),
      })
      .refine(
        (value) =>
          value.pattern !== undefined ||
          value.kind !== undefined ||
          value.regex !== undefined ||
          value.inside !== undefined ||
          value.has !== undefined ||
          value.all !== undefined ||
          value.any !== undefined ||
          value.not !== undefined,
        { message: "Rule must define at least one matcher field." },
      );

  relationalRuleSchema = z.lazy(() =>
    createRuleObjectSchema().extend({
      field: z.string().min(1).optional(),
      stopBy: z.union([editCodeRelationalStopByKeywordSchema, ruleSchema]).optional(),
    }),
  );

  ruleSchema = z.lazy(() => {
    return z.union([editCodePatternSchema, createRuleObjectSchema()]);
  });
  return ruleSchema;
}

export const editCodeRuleSchema = createEditCodeRuleSchema();

export const editCodeReplaceEditSchema = z.object({
  op: z.literal("replace"),
  rule: editCodeRuleSchema,
  replacement: z.string(),
  ...editCodeScopeSchema,
});

export const editCodeRenameEditSchema = z.object({
  op: z.literal("rename"),
  from: z.string().min(1),
  to: z.string().min(1),
  target: editCodeRenameTargetSchema.optional(),
  ...editCodeScopeSchema,
});

export const editCodeEditSchema = z.discriminatedUnion("op", [editCodeReplaceEditSchema, editCodeRenameEditSchema]);

export type EditCodeReplaceEdit = z.infer<typeof editCodeReplaceEditSchema>;
export type EditCodeRenameEdit = z.infer<typeof editCodeRenameEditSchema>;
export type EditCodeEdit = z.infer<typeof editCodeEditSchema>;
