import { z } from "zod";

export const inputEditActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("insert"), text: z.string() }),
  z.object({ kind: z.literal("delete-backward") }),
  z.object({ kind: z.literal("delete-forward") }),
  z.object({ kind: z.literal("move"), direction: z.enum(["left", "right", "home", "end"]) }),
  z.object({ kind: z.literal("replace"), text: z.string(), cursor: z.number().int().nonnegative().optional() }),
]);
export type InputEditAction = z.infer<typeof inputEditActionSchema>;
export const inputControllerStateSchema = z.object({ text: z.string(), cursor: z.number().int().nonnegative() });
export type InputControllerState = z.infer<typeof inputControllerStateSchema>;

export function createInputController(text = ""): InputControllerState {
  return { text, cursor: text.length };
}

export function reduceInput(state: InputControllerState, action: InputEditAction): InputControllerState {
  const cursor = Math.min(state.cursor, state.text.length);
  switch (action.kind) {
    case "insert":
      return {
        text: `${state.text.slice(0, cursor)}${action.text}${state.text.slice(cursor)}`,
        cursor: cursor + action.text.length,
      };
    case "delete-backward":
      return cursor === 0
        ? { ...state, cursor }
        : { text: `${state.text.slice(0, cursor - 1)}${state.text.slice(cursor)}`, cursor: cursor - 1 };
    case "delete-forward":
      return cursor >= state.text.length
        ? { ...state, cursor }
        : { text: `${state.text.slice(0, cursor)}${state.text.slice(cursor + 1)}`, cursor };
    case "move":
      return {
        ...state,
        cursor:
          action.direction === "left"
            ? Math.max(0, cursor - 1)
            : action.direction === "right"
              ? Math.min(state.text.length, cursor + 1)
              : action.direction === "home"
                ? 0
                : state.text.length,
      };
    case "replace":
      return { text: action.text, cursor: Math.min(action.cursor ?? action.text.length, action.text.length) };
  }
}
