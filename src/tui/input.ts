import type { InputHandler, KeyEvent } from "./context";

/** ASCII control codepoints used in terminal input. */
const Codepoint = {
  ESC: 0x1b,
  CR: 0x0d,
  LF: 0x0a,
  TAB: 0x09,
  BS: 0x08,
  DEL: 0x7f,
  SPACE: 0x20,
  CTRL_A: 1,
  CTRL_Z: 26,
  CTRL_OFFSET: 96,
} as const;

/** String forms of control chars used in string comparisons. */
const Char = {
  DEL: "\x7f",
  BS: "\x08",
} as const;

const ESCAPE = "\x1b";

export type KeyInputEvent = { input: string; key: KeyEvent };

export function emptyKey(): KeyEvent {
  return {
    return: false,
    tab: false,
    shift: false,
    ctrl: false,
    meta: false,
    super: false,
    escape: false,
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    home: false,
    end: false,
    backspace: false,
    delete: false,
    paste: false,
  };
}

function applyModifiers(key: KeyEvent, mod: number): void {
  if (mod >= 2) {
    const bits = mod - 1;
    key.shift = (bits & 1) !== 0;
    key.meta = (bits & 2) !== 0;
    key.ctrl = (bits & 4) !== 0;
    key.super = (bits & 8) !== 0;
  }
}

/** Kitty keyboard protocol: CSI <codepoint> ; <modifiers> u */
function parseKittySequence(seq: string, key: KeyEvent): KeyInputEvent | null {
  const match = seq.match(/^(\d+)(?:;(\d+))?u$/);
  if (!match) return null;

  const codepoint = Number.parseInt(match[1] ?? "0", 10);
  const mod = Number.parseInt(match[2] ?? "1", 10);
  applyModifiers(key, mod);

  switch (codepoint) {
    case Codepoint.ESC:
      key.escape = true;
      return { input: "", key };
    case Codepoint.CR:
      key.return = true;
      return { input: "", key };
    case Codepoint.TAB:
      key.tab = true;
      return { input: "", key };
    case Codepoint.DEL:
      key.backspace = true;
      return { input: "", key };
    default: {
      if (codepoint >= Codepoint.SPACE) {
        const ch = String.fromCodePoint(codepoint);
        return { input: ch, key };
      }
      return { input: "", key };
    }
  }
}

const MAX_CSI_LENGTH = 64;

type CsiScan = { kind: "complete"; end: number } | { kind: "truncated" } | { kind: "invalid" };

/**
 * Scan a CSI sequence starting at `offset` (pointing at ESC).
 * CSI = ESC [ <params> <final byte>, final byte 0x40–0x7E. `truncated` means the
 * input ran out before the final byte, which a later read can still complete.
 */
function scanCsi(raw: string, offset: number): CsiScan {
  if (raw[offset + 1] !== "[") return { kind: "invalid" };
  let i = offset + 2;
  while (i < raw.length) {
    if (i - offset > MAX_CSI_LENGTH) return { kind: "invalid" };
    const code = raw.charCodeAt(i);
    if (code >= 0x40 && code <= 0x7e) return { kind: "complete", end: i + 1 };
    i++;
  }
  return { kind: "truncated" };
}

/**
 * Parse a single key event starting at `offset` in `raw`.
 * Returns the parsed event and the number of bytes consumed.
 */
function parseSingle(raw: string, offset: number): { event: KeyInputEvent; consumed: number } {
  const ch0 = raw[offset] ?? "";
  const code0 = raw.charCodeAt(offset);

  // CSI sequences: ESC [
  if (ch0 === ESCAPE && offset + 1 < raw.length && raw[offset + 1] === "[") {
    const scan = scanCsi(raw, offset);
    if (scan.kind === "complete") {
      const end = scan.end;
      const seq = raw.slice(offset + 2, end);
      const key = emptyKey();

      const kittyResult = parseKittySequence(seq, key);
      if (kittyResult) return { event: kittyResult, consumed: end - offset };

      // Delete key with modifiers: CSI 3 ; <mod> ~
      const deleteModMatch = seq.match(/^3;(\d+)~$/);
      if (deleteModMatch) {
        const mod = Number.parseInt(deleteModMatch[1] ?? "1", 10);
        applyModifiers(key, mod);
        key.delete = true;
        return { event: { input: "", key }, consumed: end - offset };
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
        return { event: { input: "", key }, consumed: end - offset };
      }

      // Home/End with modifiers: CSI 1 ; <mod> <H|F>
      const homeEndModMatch = seq.match(/^1;(\d+)([HF])$/);
      if (homeEndModMatch) {
        const mod = Number.parseInt(homeEndModMatch[1] ?? "1", 10);
        applyModifiers(key, mod);
        if (homeEndModMatch[2] === "H") key.home = true;
        else key.end = true;
        return { event: { input: "", key }, consumed: end - offset };
      }

      // Simple arrows
      if (seq === "A") {
        key.upArrow = true;
        return { event: { input: "", key }, consumed: end - offset };
      }
      if (seq === "B") {
        key.downArrow = true;
        return { event: { input: "", key }, consumed: end - offset };
      }
      if (seq === "C") {
        key.rightArrow = true;
        return { event: { input: "", key }, consumed: end - offset };
      }
      if (seq === "D") {
        key.leftArrow = true;
        return { event: { input: "", key }, consumed: end - offset };
      }

      // Home/End
      if (seq === "H" || seq === "1~" || seq === "7~") {
        key.home = true;
        return { event: { input: "", key }, consumed: end - offset };
      }
      if (seq === "F" || seq === "4~" || seq === "8~") {
        key.end = true;
        return { event: { input: "", key }, consumed: end - offset };
      }

      // Delete key: CSI 3 ~
      if (seq === "3~") {
        key.delete = true;
        return { event: { input: "", key }, consumed: end - offset };
      }

      // Shift+Tab: CSI Z
      if (seq === "Z") {
        key.tab = true;
        key.shift = true;
        return { event: { input: "", key }, consumed: end - offset };
      }

      // Unknown CSI — consume but noop
      return { event: { input: "", key }, consumed: end - offset };
    }
  }

  // SS3 sequences: ESC O <letter>
  if (ch0 === ESCAPE && offset + 2 < raw.length && raw[offset + 1] === "O") {
    const key = emptyKey();
    const letter = raw[offset + 2];
    if (letter === "H") key.home = true;
    else if (letter === "F") key.end = true;
    else if (letter === "A") key.upArrow = true;
    else if (letter === "B") key.downArrow = true;
    else if (letter === "C") key.rightArrow = true;
    else if (letter === "D") key.leftArrow = true;
    return { event: { input: "", key }, consumed: 3 };
  }

  // Meta prefix: ESC + char (Alt+key)
  if (ch0 === ESCAPE && offset + 1 < raw.length && raw[offset + 1] !== "[" && raw[offset + 1] !== "O") {
    const key = emptyKey();
    key.meta = true;
    const ch = raw[offset + 1] ?? "";
    if (ch === Char.DEL || ch === Char.BS) {
      key.backspace = true;
      return { event: { input: "", key }, consumed: 2 };
    }
    const code1 = raw.charCodeAt(offset + 1);
    if (code1 === Codepoint.CR || code1 === Codepoint.LF) {
      key.return = true;
      return { event: { input: "", key }, consumed: 2 };
    }
    return { event: { input: ch, key }, consumed: 2 };
  }

  // Standalone escape
  if (ch0 === ESCAPE) {
    const key = emptyKey();
    key.escape = true;
    return { event: { input: "", key }, consumed: 1 };
  }

  // Control characters
  const key = emptyKey();

  if (code0 === Codepoint.CR) {
    key.return = true;
    return { event: { input: "", key }, consumed: 1 };
  }
  if (code0 === Codepoint.LF) {
    key.return = true;
    key.shift = true;
    return { event: { input: "", key }, consumed: 1 };
  }
  if (code0 === Codepoint.TAB) {
    key.tab = true;
    return { event: { input: "", key }, consumed: 1 };
  }
  if (code0 === Codepoint.DEL || code0 === Codepoint.BS) {
    key.backspace = true;
    return { event: { input: "", key }, consumed: 1 };
  }
  if (code0 >= Codepoint.CTRL_A && code0 <= Codepoint.CTRL_Z) {
    key.ctrl = true;
    return { event: { input: String.fromCharCode(code0 + Codepoint.CTRL_OFFSET), key }, consumed: 1 };
  }

  // Regular character
  return { event: { input: ch0, key }, consumed: 1 };
}

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const FOCUS_IN = "\x1b[I";

/**
 * A paste is held until its terminator arrives, so the terminator can land in a later read.
 * Past this much content the terminator is treated as lost and the text is released: raw mode
 * routes interrupt and escape through this parser, so a paste held forever would swallow every
 * later keystroke and leave no way out of the session.
 */
const MAX_PASTE_LENGTH = 256 * 1024;

type PasteScan = { kind: "incomplete" } | { kind: "complete"; events: KeyInputEvent[]; consumed: number };

function pasteEvents(content: string, consumed: number): PasteScan {
  const text = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const events: KeyInputEvent[] = [];
  for (const ch of text) {
    events.push({ input: ch, key: { ...emptyKey(), paste: true } });
  }
  return { kind: "complete", events, consumed };
}

function parseBracketedPaste(raw: string, offset: number): PasteScan | null {
  if (!raw.startsWith(PASTE_START, offset)) return null;
  const contentStart = offset + PASTE_START.length;
  const terminator = raw.indexOf(PASTE_END, contentStart);
  if (terminator >= 0) {
    return pasteEvents(raw.slice(contentStart, terminator), terminator + PASTE_END.length - offset);
  }
  if (raw.length - contentStart <= MAX_PASTE_LENGTH) return { kind: "incomplete" };
  return pasteEvents(raw.slice(contentStart), raw.length - offset);
}

/**
 * True when the tail of `raw` is a sequence a later read can still complete.
 * A bare trailing ESC is excluded: it is the escape key, and holding it back would
 * strand the keypress until the user types again. The cost of that choice is that
 * an ESC introducer already followed by `[` or `O` is indistinguishable from Alt+`[`
 * or Alt+`O`, so those two chords lose their character when split across reads.
 */
function isTruncatedSequence(raw: string, offset: number): boolean {
  if (raw[offset] !== ESCAPE || offset + 1 >= raw.length) return false;
  if (raw[offset + 1] === "O") return offset + 2 >= raw.length;
  if (raw[offset + 1] !== "[") return false;
  return scanCsi(raw, offset).kind === "truncated";
}

/**
 * Parse a stdin stream into key events. A tty read can split a sequence, so the
 * parser holds the incomplete tail and the partial UTF-8 bytes until the rest arrives.
 */
function createKeyInputParser(): {
  parse: (data: Buffer | string) => { events: KeyInputEvent[]; focusIn: boolean };
} {
  const decoder = new TextDecoder("utf-8");
  let pending = "";

  return {
    parse(data: Buffer | string) {
      const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
      const raw = pending + decoder.decode(bytes, { stream: true });
      pending = "";
      const events: KeyInputEvent[] = [];
      let focusIn = false;
      let offset = 0;

      while (offset < raw.length) {
        const paste = parseBracketedPaste(raw, offset);
        if (paste) {
          if (paste.kind === "incomplete") {
            pending = raw.slice(offset);
            break;
          }
          events.push(...paste.events);
          offset += paste.consumed;
          continue;
        }
        if (raw.startsWith(FOCUS_IN, offset)) {
          focusIn = true;
          offset += FOCUS_IN.length;
          continue;
        }
        if (isTruncatedSequence(raw, offset)) {
          pending = raw.slice(offset);
          break;
        }
        const { event, consumed } = parseSingle(raw, offset);
        events.push(event);
        offset += consumed;
      }

      return { events, focusIn };
    },
  };
}

export function createInputDispatcher(options: { onFocusIn?: () => void } = {}): {
  handlers: Set<{ handler: InputHandler; isActive: boolean }>;
  dispatch: (data: Buffer | string) => void;
} {
  const handlers = new Set<{ handler: InputHandler; isActive: boolean }>();
  const parser = createKeyInputParser();
  return {
    handlers,
    dispatch(data: Buffer | string) {
      const { events, focusIn } = parser.parse(data);
      if (focusIn) options.onFocusIn?.();
      for (const { input, key } of events) {
        for (const reg of handlers) {
          if (reg.isActive) reg.handler(input, key);
        }
      }
    },
  };
}
