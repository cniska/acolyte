import { unreachable } from "./assert";
import type { InputControllerState, InputEditAction } from "./input-controller";
import { moveLineDown, moveLineUp } from "./prompt-display";
import type { KeyEvent } from "./tui/context";

export type PromptAction =
  | { type: "noop" }
  | { type: "submit" }
  | { type: "move_home" }
  | { type: "move_end" }
  | { type: "move_left" }
  | { type: "move_right" }
  | { type: "move_word_left" }
  | { type: "move_word_right" }
  | { type: "delete_back" }
  | { type: "delete_forward" }
  | { type: "delete_word_back" }
  | { type: "clear_line" }
  | { type: "move_up" }
  | { type: "move_down" }
  | { type: "insert"; text: string; paste: boolean };

export type PromptEditDecision = { kind: "submit" } | { kind: "edit"; action: InputEditAction } | { kind: "none" };

// Chords that consume the armed meta prefix; a move or a submit leaves it armed.
const META_PREFIX_CONSUMERS = new Set<PromptAction["type"]>([
  "noop",
  "insert",
  "delete_back",
  "delete_forward",
  "delete_word_back",
  "clear_line",
]);

export function resolvePromptAction(input: string, key: KeyEvent, options: { hasMetaPrefix: boolean }): PromptAction {
  // Noop: tab, ctrl+c
  if (key.tab || (key.shift && key.tab) || (key.ctrl && input === "c")) return { type: "noop" };

  // Vertical line navigation
  if (key.upArrow) return { type: "move_up" };
  if (key.downArrow) return { type: "move_down" };

  // Submit / newline
  if (key.return && key.shift) return { type: "insert", text: "\n", paste: key.paste };
  if (key.return && key.meta) return { type: "insert", text: "\n", paste: key.paste };
  if (key.return) return { type: "submit" };

  // Home: Home key, Cmd+Left, Ctrl+A
  if (key.home || (key.super && key.leftArrow) || (key.ctrl && input === "a")) return { type: "move_home" };

  // End: End key, Cmd+Right, Ctrl+E
  if (key.end || (key.super && key.rightArrow) || (key.ctrl && input === "e")) return { type: "move_end" };

  // Word left: Alt+Left, Ctrl+Left, Alt+B
  if ((key.meta || key.ctrl) && key.leftArrow) return { type: "move_word_left" };
  if (key.meta && input === "b") return { type: "move_word_left" };

  // Word right: Alt+Right, Ctrl+Right, Alt+F
  if ((key.meta || key.ctrl) && key.rightArrow) return { type: "move_word_right" };
  if (key.meta && input === "f") return { type: "move_word_right" };

  // Delete word back: Ctrl+W, Alt+Backspace, meta prefix + backspace
  if (key.ctrl && input === "w") return { type: "delete_word_back" };
  if (key.meta && (key.backspace || key.delete)) return { type: "delete_word_back" };
  if (options.hasMetaPrefix && key.backspace) return { type: "delete_word_back" };

  // Clear line: Ctrl+U
  if (key.ctrl && input === "u") return { type: "clear_line" };

  // Simple arrow movement
  if (key.leftArrow) return { type: "move_left" };
  if (key.rightArrow) return { type: "move_right" };

  // Forward delete
  if (key.delete) return { type: "delete_forward" };

  // Backspace
  if (key.backspace) return { type: "delete_back" };

  // No printable input or modifier held — noop
  if (!input || key.ctrl || key.meta) return { type: "noop" };

  return { type: "insert", text: input, paste: key.paste };
}

export function consumesMetaPrefix(action: PromptAction): boolean {
  return META_PREFIX_CONSUMERS.has(action.type);
}

const NONE: PromptEditDecision = { kind: "none" };
const asEdit = (action: InputEditAction): PromptEditDecision => ({ kind: "edit", action });

export function resolvePromptEdit(
  action: PromptAction,
  state: InputControllerState,
  wrapWidth?: number,
): PromptEditDecision {
  const { text, cursor } = state;
  switch (action.type) {
    case "noop":
      return NONE;
    case "submit":
      return { kind: "submit" };
    case "move_home":
      return asEdit({ kind: "move", direction: "home" });
    case "move_end":
      return asEdit({ kind: "move", direction: "end" });
    case "move_left":
      return asEdit({ kind: "move", direction: "left" });
    case "move_right":
      return asEdit({ kind: "move", direction: "right" });
    case "move_word_left":
      return asEdit({ kind: "move-word", direction: "left" });
    case "move_word_right":
      return asEdit({ kind: "move-word", direction: "right" });
    case "move_up":
      return asEdit({ kind: "set-cursor", cursor: moveLineUp(text, cursor, wrapWidth) });
    case "move_down":
      return asEdit({ kind: "set-cursor", cursor: moveLineDown(text, cursor, wrapWidth) });
    case "delete_word_back":
      return cursor === 0 ? NONE : asEdit({ kind: "delete-word-backward" });
    case "clear_line":
      return text.length === 0 ? NONE : asEdit({ kind: "clear" });
    case "delete_back":
      return cursor === 0 ? NONE : asEdit({ kind: "delete-backward" });
    case "delete_forward":
      return cursor >= text.length ? NONE : asEdit({ kind: "delete-forward" });
    // A lone "?" opens help instead of typing, so it reaches the buffer only as paste.
    case "insert":
      return text.length === 0 && action.text === "?" && !action.paste
        ? NONE
        : asEdit({ kind: "insert", text: action.text });
    default:
      return unreachable(action);
  }
}
