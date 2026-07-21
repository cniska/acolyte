import { z } from "zod";
import { terminalStyleRoleSchema } from "./terminal-theme";

export const terminalSpanSchema = z.object({ text: z.string(), role: terminalStyleRoleSchema });
export type TerminalSpan = z.infer<typeof terminalSpanSchema>;
export const terminalLineSchema = z.object({
  spans: z.array(terminalSpanSchema),
  fill: terminalStyleRoleSchema.optional(),
});
export type TerminalLine = z.infer<typeof terminalLineSchema>;
export const terminalCursorSchema = z.object({
  row: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
});
export type TerminalCursor = z.infer<typeof terminalCursorSchema>;
export const terminalSceneSectionSchema = z.object({
  id: z.string().min(1),
  lineStart: z.number().int().nonnegative(),
  lineEnd: z.number().int().nonnegative(),
  finalized: z.boolean(),
});
export type TerminalSceneSection = z.infer<typeof terminalSceneSectionSchema>;
export const terminalSceneSchema = z.object({
  lines: z.array(terminalLineSchema),
  cursor: terminalCursorSchema.optional(),
  sections: z.array(terminalSceneSectionSchema).optional(),
});
export type TerminalScene = z.infer<typeof terminalSceneSchema>;

export function finalizeScene(scene: TerminalScene): TerminalScene {
  return Object.freeze({
    ...scene,
    lines: Object.freeze(scene.lines.map((line) => Object.freeze({ ...line, spans: Object.freeze([...line.spans]) }))),
    sections: Object.freeze((scene.sections ?? []).map((section) => Object.freeze({ ...section }))),
  }) as TerminalScene;
}
