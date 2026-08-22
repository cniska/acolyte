import { describe, expect, test } from "bun:test";
import { createInputDispatcher, type KeyInputEvent } from "./input";

/** Feed chunks through one dispatcher, as separate stdin reads. */
function collect(chunks: Array<Buffer | string>, options: { onFocusIn?: () => void } = {}): KeyInputEvent[] {
  const dispatcher = createInputDispatcher(options);
  const events: KeyInputEvent[] = [];
  dispatcher.handlers.add({
    isActive: true,
    handler: (input, key) => {
      events.push({ input, key });
    },
  });
  for (const chunk of chunks) dispatcher.dispatch(chunk);
  return events;
}

function parseKeyInput(data: string) {
  return collect([data]);
}

function parse(data: string) {
  const results = parseKeyInput(data);
  return results[0] ?? { input: "", key: {} };
}

describe("parseKeyInput", () => {
  test("regular character", () => {
    const { input, key } = parse("a");
    expect(input).toBe("a");
    expect(key.ctrl).toBe(false);
    expect(key.meta).toBe(false);
  });

  test("enter (CR) triggers return", () => {
    const { input, key } = parse("\r");
    expect(key.return).toBe(true);
    expect(key.shift).toBe(false);
    expect(input).toBe("");
  });

  test("line feed (LF) triggers shift+return for newline insert", () => {
    const { input, key } = parse("\n");
    expect(key.return).toBe(true);
    expect(key.shift).toBe(true);
    expect(input).toBe("");
  });

  test("alt+enter (ESC CR) triggers meta+return for newline insert", () => {
    const { input, key } = parse("\x1b\r");
    expect(key.return).toBe(true);
    expect(key.meta).toBe(true);
    expect(input).toBe("");
  });

  test("tab", () => {
    const { input, key } = parse("\t");
    expect(key.tab).toBe(true);
    expect(input).toBe("");
  });

  test("backspace", () => {
    const { input, key } = parse("\x7f");
    expect(key.backspace).toBe(true);
    expect(input).toBe("");
  });

  test("escape", () => {
    const { input, key } = parse("\x1b");
    expect(key.escape).toBe(true);
    expect(input).toBe("");
  });

  test("ctrl+c", () => {
    const { input, key } = parse("\x03");
    expect(key.ctrl).toBe(true);
    expect(input).toBe("c");
  });

  test("arrow up", () => {
    const { input, key } = parse("\x1b[A");
    expect(key.upArrow).toBe(true);
    expect(input).toBe("");
  });

  test("arrow down", () => {
    const { input, key } = parse("\x1b[B");
    expect(key.downArrow).toBe(true);
    expect(input).toBe("");
  });

  test("shift+tab", () => {
    const { input, key } = parse("\x1b[Z");
    expect(key.tab).toBe(true);
    expect(key.shift).toBe(true);
    expect(input).toBe("");
  });

  test("delete key", () => {
    const { input, key } = parse("\x1b[3~");
    expect(key.delete).toBe(true);
    expect(input).toBe("");
  });

  test("home key", () => {
    const { input, key } = parse("\x1b[H");
    expect(key.home).toBe(true);
    expect(input).toBe("");
  });

  test("end key", () => {
    const { input, key } = parse("\x1b[F");
    expect(key.end).toBe(true);
    expect(input).toBe("");
  });

  test("SS3 home/end", () => {
    expect(parse("\x1bOH").key.home).toBe(true);
    expect(parse("\x1bOF").key.end).toBe(true);
    expect(parse("\x1bOH").input).toBe("");
  });

  describe("kitty keyboard protocol", () => {
    test("escape via kitty", () => {
      const { key } = parse("\x1b[27u");
      expect(key.escape).toBe(true);
    });

    test("enter via kitty", () => {
      const { key } = parse("\x1b[13u");
      expect(key.return).toBe(true);
    });

    test("ctrl+a via kitty", () => {
      const { input, key } = parse("\x1b[97;5u");
      expect(key.ctrl).toBe(true);
      expect(input).toBe("a");
    });

    test("shift+enter via kitty", () => {
      const { key } = parse("\x1b[13;2u");
      expect(key.return).toBe(true);
      expect(key.shift).toBe(true);
    });

    test("regular char via kitty", () => {
      const { input } = parse("\x1b[120u");
      expect(input).toBe("x");
    });
  });

  describe("modifier arrows", () => {
    test("shift+up", () => {
      const { input, key } = parse("\x1b[1;2A");
      expect(key.upArrow).toBe(true);
      expect(key.shift).toBe(true);
      expect(input).toBe("");
    });

    test("alt+right (word nav)", () => {
      const { input, key } = parse("\x1b[1;3C");
      expect(key.rightArrow).toBe(true);
      expect(key.meta).toBe(true);
      expect(input).toBe("");
    });

    test("ctrl+left (word nav)", () => {
      const { input, key } = parse("\x1b[1;5D");
      expect(key.leftArrow).toBe(true);
      expect(key.ctrl).toBe(true);
      expect(input).toBe("");
    });

    test("super+left (Cmd+arrow, line nav)", () => {
      const { input, key } = parse("\x1b[1;9D");
      expect(key.leftArrow).toBe(true);
      expect(key.super).toBe(true);
      expect(input).toBe("");
    });

    test("super+right (Cmd+arrow, line nav)", () => {
      const { input, key } = parse("\x1b[1;9C");
      expect(key.rightArrow).toBe(true);
      expect(key.super).toBe(true);
      expect(input).toBe("");
    });

    test("super+shift+left (Cmd+Shift+arrow)", () => {
      const { key } = parse("\x1b[1;10D");
      expect(key.leftArrow).toBe(true);
      expect(key.super).toBe(true);
      expect(key.shift).toBe(true);
    });

    test("super+home", () => {
      const { key } = parse("\x1b[1;9H");
      expect(key.home).toBe(true);
      expect(key.super).toBe(true);
    });
  });

  describe("meta prefix", () => {
    test("alt+backspace", () => {
      const { input, key } = parse("\x1b\x7f");
      expect(key.meta).toBe(true);
      expect(key.backspace).toBe(true);
      expect(input).toBe("");
    });

    test("alt+b (word left)", () => {
      const { input, key } = parse("\x1bb");
      expect(key.meta).toBe(true);
      expect(input).toBe("b");
    });

    test("alt+f (word right)", () => {
      const { input, key } = parse("\x1bf");
      expect(key.meta).toBe(true);
      expect(input).toBe("f");
    });
  });

  describe("CSI input field is empty", () => {
    test("parsed CSI sequences yield empty input", () => {
      expect(parse("\x1b[A").input).toBe("");
      expect(parse("\x1b[1;5D").input).toBe("");
      expect(parse("\x1b[3~").input).toBe("");
      expect(parse("\x1b[1;9C").input).toBe("");
    });
  });

  describe("bracketed paste", () => {
    test("pasted text with newlines emits insert events, not return", () => {
      // Bracketed paste: ESC[200~ <content> ESC[201~
      const pasted = "\x1b[200~hello\nworld\x1b[201~";
      const results = parseKeyInput(pasted);
      // Should produce insert events for the text, no return key
      const hasReturn = results.some((r) => r.key.return);
      expect(hasReturn).toBe(false);
      const text = results.map((r) => r.input).join("");
      expect(text).toBe("hello\nworld");
    });

    test("pasted text preserves CR+LF as newlines", () => {
      const pasted = "\x1b[200~line1\r\nline2\x1b[201~";
      const results = parseKeyInput(pasted);
      const hasReturn = results.some((r) => r.key.return);
      expect(hasReturn).toBe(false);
      const text = results.map((r) => r.input).join("");
      expect(text).toBe("line1\nline2");
    });

    test("regular enter outside paste still triggers return", () => {
      const results = parseKeyInput("\r");
      expect(results[0]?.key.return).toBe(true);
    });

    test("pasted chars are flagged paste; typed chars are not", () => {
      const pasted = parseKeyInput("\x1b[200~a?\x1b[201~");
      expect(pasted.every((r) => r.key.paste)).toBe(true);
      const typed = parseKeyInput("?");
      expect(typed[0]?.key.paste).toBe(false);
    });

    test("unterminated paste emits nothing until its terminator arrives", () => {
      const results = parseKeyInput("\x1b[200~hello world");
      expect(results).toHaveLength(0);
    });

    test("empty paste produces no events", () => {
      const pasted = "\x1b[200~\x1b[201~";
      const results = parseKeyInput(pasted);
      expect(results).toHaveLength(0);
    });
  });

  describe("multi-sequence chunks", () => {
    test("ctrl+u followed by left arrow in one chunk", () => {
      const results = parseKeyInput("\x15\x1b[D");
      expect(results).toHaveLength(2);
      expect(results[0]?.key.ctrl).toBe(true);
      expect(results[0]?.input).toBe("u");
      expect(results[1]?.key.leftArrow).toBe(true);
      expect(results[1]?.input).toBe("");
    });

    test("multiple plain characters in one chunk", () => {
      const results = parseKeyInput("abc");
      expect(results).toHaveLength(3);
      expect(results[0]?.input).toBe("a");
      expect(results[1]?.input).toBe("b");
      expect(results[2]?.input).toBe("c");
    });

    test("escape sequence followed by regular char", () => {
      const results = parseKeyInput("\x1b[Ax");
      expect(results).toHaveLength(2);
      expect(results[0]?.key.upArrow).toBe(true);
      expect(results[1]?.input).toBe("x");
    });
  });
  describe("sequences split across stdin reads", () => {
    test("an arrow-key CSI split across two reads is one arrow event", () => {
      const events = collect(["\x1b[", "A"]);
      expect(events).toHaveLength(1);
      expect(events[0]?.key.upArrow).toBe(true);
      expect(events[0]?.input).toBe("");
    });

    test("a modified arrow split mid-parameters is one arrow event", () => {
      const events = collect(["\x1b[1;", "5C"]);
      expect(events).toHaveLength(1);
      expect(events[0]?.key.rightArrow).toBe(true);
      expect(events[0]?.key.ctrl).toBe(true);
    });

    test("an SS3 sequence split after the introducer is one arrow event", () => {
      const events = collect(["\x1bO", "B"]);
      expect(events).toHaveLength(1);
      expect(events[0]?.key.downArrow).toBe(true);
    });

    test("a paste terminator split inside its own marker still ends the paste", () => {
      const events = collect(["\x1b[200~ab\x1b[201", "~\r"]);
      expect(
        events
          .filter((e) => e.key.paste)
          .map((e) => e.input)
          .join(""),
      ).toBe("ab");
      expect(events.filter((e) => e.key.return)).toHaveLength(1);
    });

    test("input recovers when a paste terminator never arrives", () => {
      const events = collect([`\x1b[200~${"a".repeat(256 * 1024 + 1)}`, "\x03"]);
      expect(events.filter((e) => e.key.paste).length).toBe(256 * 1024 + 1);
      const interrupt = events.filter((e) => e.key.ctrl && e.input === "c");
      expect(interrupt).toHaveLength(1);
    });

    test("a bracketed paste split across two reads never leaks a return key", () => {
      const events = collect(["\x1b[200~hello ", "world\nline2\x1b[201~"]);
      expect(events.some((e) => e.key.return)).toBe(false);
      expect(events.every((e) => e.key.paste)).toBe(true);
      expect(events.map((e) => e.input).join("")).toBe("hello world\nline2");
    });

    test("a paste marker split mid-sequence still opens the paste", () => {
      const events = collect(["\x1b[20", "0~a\rb\x1b[201~"]);
      expect(events.some((e) => e.key.return)).toBe(false);
      expect(events.map((e) => e.input).join("")).toBe("a\nb");
    });

    test("a paste split so CRLF straddles the boundary yields one newline", () => {
      const events = collect(["\x1b[200~a\r", "\nb\x1b[201~"]);
      expect(events.some((e) => e.key.return)).toBe(false);
      expect(events.map((e) => e.input).join("")).toBe("a\nb");
    });

    test("a kitty sequence split mid-parameters is one key event", () => {
      const events = collect(["\x1b[27;", "5u"]);
      expect(events).toHaveLength(1);
      expect(events[0]?.key.escape).toBe(true);
      expect(events[0]?.key.ctrl).toBe(true);
    });

    test("an over-long unterminated CSI is flushed instead of buffered forever", () => {
      const events = collect([`\x1b[${"1".repeat(70)}`]);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.key.escape).toBe(true);
    });

    test("a burst whose read boundary lands on ESC still yields the arrow", () => {
      const events = collect(["abc\x1b", "[D"]);
      expect(events.map((e) => e.input).join("")).toBe("abc");
      expect(events.filter((e) => e.key.leftArrow)).toHaveLength(1);
      expect(events.some((e) => e.key.escape)).toBe(false);
    });

    test("an escape that is the whole read dispatches at once", () => {
      const events = collect(["\x1b"]);
      expect(events).toHaveLength(1);
      expect(events[0]?.key.escape).toBe(true);
    });

    test("an escape coalesced with earlier keystrokes still reaches the interrupt", () => {
      const events = collect(["no\x1b", "\x03"]);
      const interrupt = events.filter((e) => e.key.ctrl && e.input === "c");
      expect(interrupt).toHaveLength(1);
      expect(events.filter((e) => e.key.escape)).toHaveLength(1);
    });

    test("an escape coalesced with earlier keystrokes releases before a plain letter", () => {
      const events = collect(["no\x1b", "x"]);
      expect(events.map((e) => e.input).join("")).toBe("nox");
      expect(events[2]?.key.escape).toBe(true);
      expect(events[3]?.key.meta).toBe(false);
    });

    test("a control byte after a held CSI introducer is not absorbed as a parameter", () => {
      const events = collect(["ab\x1b", "[", "\x03"]);
      const interrupt = events.filter((e) => e.key.ctrl && e.input === "c");
      expect(interrupt).toHaveLength(1);
      expect(events.filter((e) => e.key.escape)).toHaveLength(1);
    });

    test("an escape coalesced with earlier keystrokes still cancels on a second press", () => {
      const events = collect(["no\x1b", "\x1b"]);
      expect(events.filter((e) => e.key.escape)).toHaveLength(2);
    });

    test("a held SS3 introducer releases the escape rather than swallowing it", () => {
      const events = collect(["\x1bO", "\x1b"]);
      expect(events.filter((e) => e.key.escape).length).toBeGreaterThanOrEqual(1);
    });

    test("a multi-byte character split across reads is one character", () => {
      const utf8 = Buffer.from("é");
      const events = collect([utf8.subarray(0, 1), utf8.subarray(1)]);
      expect(events.map((e) => e.input).join("")).toBe("é");
    });

    test("a focus-in report split across reads fires once and dispatches no keys", () => {
      let focusIn = 0;
      const events = collect(["\x1b[", "Ia"], {
        onFocusIn: () => {
          focusIn += 1;
        },
      });
      expect(focusIn).toBe(1);
      expect(events.map((e) => e.input).join("")).toBe("a");
    });
  });
});
