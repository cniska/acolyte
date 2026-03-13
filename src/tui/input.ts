import type { InputHandler, KeyEvent } from "./context";

const ESCAPE = "\x1b";

function emptyKey(): KeyEvent {
  return {
    return: false,
    tab: false,
    shift: false,
    ctrl: false,
    meta: false,
    escape: false,
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    home: false,
    end: false,
    backspace: false,
    delete: false,
  };
}

/** Parse raw stdin data into (input, key) pairs compatible with Ink's useInput. */
export function parseKeyInput(data: Buffer | string): Array<{ input: string; key: KeyEvent }> {
  const raw = typeof data === "string" ? data : data.toString("utf8");
  const results: Array<{ input: string; key: KeyEvent }> = [];

  // CSI sequences: ESC [ ... final_byte
  if (raw.startsWith(`${ESCAPE}[`)) {
    const key = emptyKey();
    const seq = raw.slice(2);

    // Arrow keys with modifiers: ESC [ 1 ; <mod> <A-D>
    const arrowModMatch = seq.match(/^1;(\d+)([A-D])$/);
    if (arrowModMatch) {
      const mod = Number.parseInt(arrowModMatch[1] ?? "1", 10);
      if (mod >= 2) key.shift = ((mod - 1) & 1) !== 0;
      if (mod >= 2) key.meta = ((mod - 1) & 2) !== 0;
      if (mod >= 2) key.ctrl = ((mod - 1) & 4) !== 0;
      const arrow = arrowModMatch[2];
      if (arrow === "A") key.upArrow = true;
      else if (arrow === "B") key.downArrow = true;
      else if (arrow === "C") key.rightArrow = true;
      else if (arrow === "D") key.leftArrow = true;
      results.push({ input: raw, key });
      return results;
    }

    // Home/End with modifiers: ESC [ 1 ; <mod> <H|F>
    const homeEndModMatch = seq.match(/^1;(\d+)([HF])$/);
    if (homeEndModMatch) {
      const mod = Number.parseInt(homeEndModMatch[1] ?? "1", 10);
      if (mod >= 2) key.shift = ((mod - 1) & 1) !== 0;
      if (mod >= 2) key.meta = ((mod - 1) & 2) !== 0;
      if (mod >= 2) key.ctrl = ((mod - 1) & 4) !== 0;
      if (homeEndModMatch[2] === "H") key.home = true;
      else key.end = true;
      results.push({ input: raw, key });
      return results;
    }

    // Simple arrows
    if (seq === "A") {
      key.upArrow = true;
      results.push({ input: raw, key });
      return results;
    }
    if (seq === "B") {
      key.downArrow = true;
      results.push({ input: raw, key });
      return results;
    }
    if (seq === "C") {
      key.rightArrow = true;
      results.push({ input: raw, key });
      return results;
    }
    if (seq === "D") {
      key.leftArrow = true;
      results.push({ input: raw, key });
      return results;
    }

    // Home/End
    if (seq === "H" || seq === "1~" || seq === "7~") {
      key.home = true;
      results.push({ input: raw, key });
      return results;
    }
    if (seq === "F" || seq === "4~" || seq === "8~") {
      key.end = true;
      results.push({ input: raw, key });
      return results;
    }

    // Delete key: ESC [ 3 ~
    if (seq === "3~") {
      key.delete = true;
      results.push({ input: raw, key });
      return results;
    }

    // Shift+Tab: ESC [ Z
    if (seq === "Z") {
      key.tab = true;
      key.shift = true;
      results.push({ input: raw, key });
      return results;
    }

    // Pass through other CSI sequences as-is
    results.push({ input: raw, key });
    return results;
  }

  // SS3 sequences: ESC O <letter>
  if (raw.startsWith(`${ESCAPE}O`)) {
    const key = emptyKey();
    const letter = raw[2];
    if (letter === "H") key.home = true;
    else if (letter === "F") key.end = true;
    else if (letter === "A") key.upArrow = true;
    else if (letter === "B") key.downArrow = true;
    else if (letter === "C") key.rightArrow = true;
    else if (letter === "D") key.leftArrow = true;
    results.push({ input: raw, key });
    return results;
  }

  // Meta prefix: ESC + char (Alt+key)
  if (raw.length >= 2 && raw[0] === ESCAPE && raw[1] !== "[" && raw[1] !== "O") {
    const key = emptyKey();
    key.meta = true;
    const ch = raw.slice(1);
    if (ch === "\x7f") {
      key.backspace = true;
      key.meta = true;
    } else if (ch === "\x08") {
      key.backspace = true;
      key.meta = true;
    }
    results.push({ input: raw, key });
    return results;
  }

  // Standalone escape
  if (raw === ESCAPE) {
    const key = emptyKey();
    key.escape = true;
    results.push({ input: raw, key });
    return results;
  }

  // Control characters
  if (raw.length === 1) {
    const code = raw.charCodeAt(0);
    const key = emptyKey();

    if (code === 0x0d || code === 0x0a) {
      key.return = true;
      results.push({ input: raw, key });
      return results;
    }
    if (code === 0x09) {
      key.tab = true;
      results.push({ input: raw, key });
      return results;
    }
    if (code === 0x7f || code === 0x08) {
      key.backspace = true;
      results.push({ input: raw, key });
      return results;
    }
    if (code >= 1 && code <= 26) {
      key.ctrl = true;
      const ch = String.fromCharCode(code + 96);
      results.push({ input: ch, key });
      return results;
    }
  }

  // Regular text input
  const key = emptyKey();
  results.push({ input: raw, key });
  return results;
}

export function createInputDispatcher(): {
  handlers: Set<{ handler: InputHandler; isActive: boolean }>;
  dispatch: (data: Buffer | string) => void;
} {
  const handlers = new Set<{ handler: InputHandler; isActive: boolean }>();
  return {
    handlers,
    dispatch(data: Buffer | string) {
      const events = parseKeyInput(data);
      for (const { input, key } of events) {
        for (const reg of handlers) {
          if (reg.isActive) reg.handler(input, key);
        }
      }
    },
  };
}
