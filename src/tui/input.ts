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

function applyModifiers(key: KeyEvent, mod: number): void {
  if (mod >= 2) {
    key.shift = ((mod - 1) & 1) !== 0;
    key.meta = ((mod - 1) & 2) !== 0;
    key.ctrl = ((mod - 1) & 4) !== 0;
  }
}

/** Kitty keyboard protocol: CSI <codepoint> ; <modifiers> u */
function parseKittySequence(seq: string, key: KeyEvent): { input: string; key: KeyEvent } | null {
  const match = seq.match(/^(\d+)(?:;(\d+))?u$/);
  if (!match) return null;

  const codepoint = Number.parseInt(match[1] ?? "0", 10);
  const mod = Number.parseInt(match[2] ?? "1", 10);
  applyModifiers(key, mod);

  switch (codepoint) {
    case 27:
      key.escape = true;
      return { input: "", key };
    case 13:
      key.return = true;
      return { input: "", key };
    case 9:
      key.tab = true;
      return { input: "", key };
    case 127:
      key.backspace = true;
      return { input: "", key };
    default: {
      if (codepoint >= 32) {
        const ch = String.fromCodePoint(codepoint);
        if (key.ctrl && codepoint >= 97 && codepoint <= 122) {
          return { input: ch, key };
        }
        return { input: ch, key };
      }
      return { input: "", key };
    }
  }
}

export function parseKeyInput(data: Buffer | string): Array<{ input: string; key: KeyEvent }> {
  const raw = typeof data === "string" ? data : data.toString("utf8");
  const results: Array<{ input: string; key: KeyEvent }> = [];

  if (raw.startsWith(`${ESCAPE}[`)) {
    const key = emptyKey();
    const seq = raw.slice(2);

    // Kitty keyboard protocol: CSI <number> ; <modifier> u
    const kittyResult = parseKittySequence(seq, key);
    if (kittyResult) {
      results.push(kittyResult);
      return results;
    }

    // Delete key with modifiers: CSI 3 ; <mod> ~
    const deleteModMatch = seq.match(/^3;(\d+)~$/);
    if (deleteModMatch) {
      const mod = Number.parseInt(deleteModMatch[1] ?? "1", 10);
      applyModifiers(key, mod);
      key.delete = true;
      results.push({ input: raw, key });
      return results;
    }

    // Arrow keys with modifiers: CSI 1 ; <mod> <A-D>
    const arrowModMatch = seq.match(/^1;(\d+)([A-D])$/);
    if (arrowModMatch) {
      const mod = Number.parseInt(arrowModMatch[1] ?? "1", 10);
      applyModifiers(key, mod);
      const arrow = arrowModMatch[2];
      if (arrow === "A") key.upArrow = true;
      else if (arrow === "B") key.downArrow = true;
      else if (arrow === "C") key.rightArrow = true;
      else if (arrow === "D") key.leftArrow = true;
      results.push({ input: raw, key });
      return results;
    }

    // Home/End with modifiers: CSI 1 ; <mod> <H|F>
    const homeEndModMatch = seq.match(/^1;(\d+)([HF])$/);
    if (homeEndModMatch) {
      const mod = Number.parseInt(homeEndModMatch[1] ?? "1", 10);
      applyModifiers(key, mod);
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

    // Delete key: CSI 3 ~
    if (seq === "3~") {
      key.delete = true;
      results.push({ input: raw, key });
      return results;
    }

    // Shift+Tab: CSI Z
    if (seq === "Z") {
      key.tab = true;
      key.shift = true;
      results.push({ input: raw, key });
      return results;
    }

    // Pass through other CSI sequences
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
    if (ch === "\x7f" || ch === "\x08") {
      key.backspace = true;
    }
    results.push({ input: raw, key });
    return results;
  }

  // Standalone escape
  if (raw === ESCAPE) {
    const key = emptyKey();
    key.escape = true;
    results.push({ input: "", key });
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
      results.push({ input: String.fromCharCode(code + 96), key });
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
