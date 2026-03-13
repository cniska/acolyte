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
  | { type: "insert"; text: string };

export function resolvePromptAction(input: string, key: KeyEvent, options: { hasMetaPrefix: boolean }): PromptAction {
  // Noop: arrows, tab, ctrl+c
  if (key.upArrow || key.downArrow || key.tab || (key.shift && key.tab) || (key.ctrl && input === "c"))
    return { type: "noop" };

  // Submit / newline
  if (key.return && key.shift) return { type: "insert", text: "\n" };
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

  return { type: "insert", text: input };
}
