export type PromptKey = {
  return?: boolean;
  tab?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  home?: boolean;
  end?: boolean;
  backspace?: boolean;
  delete?: boolean;
};

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

const ESCAPE_CHAR = "\u001b";

const CTRL = {
  c: "c",
  a: "a",
  e: "e",
  h: "\u0008",
  u: "u",
  clearLine: "\u0015",
  w: "w",
  wordDelete: "\u0017",
} as const;

const ESC = {
  altB: `${ESCAPE_CHAR}b`,
  altF: `${ESCAPE_CHAR}f`,
  altBackspace: `${ESCAPE_CHAR}\u007f`,
  altCtrlH: `${ESCAPE_CHAR}\u0008`,
  delete: `${ESCAPE_CHAR}[3~`,
  home: new Set([`${ESCAPE_CHAR}[H`, `${ESCAPE_CHAR}OH`, `${ESCAPE_CHAR}[1~`, `${ESCAPE_CHAR}[7~`]),
  end: new Set([`${ESCAPE_CHAR}[F`, `${ESCAPE_CHAR}OF`, `${ESCAPE_CHAR}[4~`, `${ESCAPE_CHAR}[8~`]),
  wordLeft: new Set([`${ESCAPE_CHAR}[1;3D`, `${ESCAPE_CHAR}[1;5D`]),
  wordRight: new Set([`${ESCAPE_CHAR}[1;3C`, `${ESCAPE_CHAR}[1;5C`]),
  lineLeft: new Set([`${ESCAPE_CHAR}[1;9D`, `${ESCAPE_CHAR}[1;7D`]),
  lineRight: new Set([`${ESCAPE_CHAR}[1;9C`, `${ESCAPE_CHAR}[1;7C`]),
} as const;

const CHARS = {
  backspace: "\u007f",
} as const;

type CsiArrowMove = {
  kind: "word" | "line";
  direction: "left" | "right";
};

type CsiLineMove = {
  kind: "line";
  direction: "left" | "right";
};

function parseCsiArrowMove(input: string): CsiArrowMove | null {
  const prefix = `${ESCAPE_CHAR}[`;
  if (!input.startsWith(prefix)) return null;
  const final = input.at(-1);
  if (final !== "C" && final !== "D") return null;
  const payload = input.slice(prefix.length, -1);
  if (payload.length === 0) return null;
  const parts = payload.split(";");
  const modifierPart = parts.length === 1 ? parts[0] : parts[1];
  if (parts.length > 2 || (parts.length === 2 && parts[0] !== "1") || !modifierPart) return null;
  const modifier = Number.parseInt(modifierPart, 10);
  const direction = final === "D" ? "left" : "right";
  if (!Number.isFinite(modifier) || modifier <= 0) return null;
  if (modifier >= 9) return { kind: "line", direction };
  if (modifier >= 3) return { kind: "word", direction };
  return null;
}

function parseCsiLineMove(input: string): CsiLineMove | null {
  const prefix = `${ESCAPE_CHAR}[`;
  if (!input.startsWith(prefix)) return null;
  const final = input.at(-1);
  if (final !== "H" && final !== "F") return null;
  const payload = input.slice(prefix.length, -1);
  if (payload.length === 0) return null;
  const parts = payload.split(";");
  const modifierPart = parts.length === 1 ? parts[0] : parts[1];
  if (parts.length > 2 || (parts.length === 2 && parts[0] !== "1") || !modifierPart) return null;
  const modifier = Number.parseInt(modifierPart, 10);
  if (!Number.isFinite(modifier) || modifier < 3) return null;
  return {
    kind: "line",
    direction: final === "H" ? "left" : "right",
  };
}

export function resolvePromptAction(input: string, key: PromptKey, options: { hasMetaPrefix: boolean }): PromptAction {
  const csiArrowMove = parseCsiArrowMove(input);
  const csiLineMove = parseCsiLineMove(input);

  if (key.upArrow || key.downArrow || key.tab || (key.shift && key.tab) || (key.ctrl && input === CTRL.c))
    return { type: "noop" };
  if (key.return && key.shift) return { type: "insert", text: "\n" };
  if (key.return) return { type: "submit" };

  if (
    key.home ||
    (key.meta && key.leftArrow) ||
    ESC.home.has(input) ||
    (key.ctrl && input === CTRL.a) ||
    ESC.lineLeft.has(input) ||
    (csiArrowMove?.kind === "line" && csiArrowMove.direction === "left") ||
    csiLineMove?.direction === "left"
  ) {
    return { type: "move_home" };
  }
  if (
    key.end ||
    (key.meta && key.rightArrow) ||
    ESC.end.has(input) ||
    (key.ctrl && input === CTRL.e) ||
    ESC.lineRight.has(input) ||
    (csiArrowMove?.kind === "line" && csiArrowMove.direction === "right") ||
    csiLineMove?.direction === "right"
  ) {
    return { type: "move_end" };
  }

  if (
    (key.meta && input === "b") ||
    input === ESC.altB ||
    ESC.wordLeft.has(input) ||
    (csiArrowMove?.kind === "word" && csiArrowMove.direction === "left")
  ) {
    return { type: "move_word_left" };
  }
  if (
    (key.meta && input === "f") ||
    input === ESC.altF ||
    ESC.wordRight.has(input) ||
    (csiArrowMove?.kind === "word" && csiArrowMove.direction === "right")
  ) {
    return { type: "move_word_right" };
  }

  if (
    (key.ctrl && input === CTRL.w) ||
    input === CTRL.wordDelete ||
    input === ESC.altBackspace ||
    input === ESC.altCtrlH
  ) {
    return { type: "delete_word_back" };
  }
  if ((key.ctrl && input === CTRL.u) || input === CTRL.clearLine || (key.meta && key.backspace))
    return { type: "clear_line" };

  if (key.leftArrow) return { type: "move_left" };
  if (key.rightArrow) return { type: "move_right" };

  const isForwardDelete = input === ESC.delete;
  if (isForwardDelete) return { type: "delete_forward" };

  const isBackspaceLike = key.backspace || key.delete || input === CTRL.h || input === CHARS.backspace;
  const isMetaWordDelete =
    (isBackspaceLike && (options.hasMetaPrefix || key.meta || input.includes(ESCAPE_CHAR))) ||
    input === ESC.altBackspace ||
    input === ESC.altCtrlH;
  if (isMetaWordDelete) return { type: "delete_word_back" };
  if (isBackspaceLike) return { type: "delete_back" };

  if (!input || key.ctrl || key.meta || input.includes(ESCAPE_CHAR)) return { type: "noop" };

  return { type: "insert", text: input };
}
