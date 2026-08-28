import { GLYPH_USER } from "./chat-glyphs";
import { t } from "./i18n";
import { dimText, writeChunk } from "./ui";

export type SelectOption<T> = { value: T; label: string };

type SelectKey = "up" | "down" | "confirm" | "cancel" | "abort" | "none";

const ESCAPE = "\u001b";
const CTRL_C = "\u0003";
const HIDE_CURSOR = `${ESCAPE}[?25l`;
const SHOW_CURSOR = `${ESCAPE}[?25h`;
const CLEAR_LINE = `${ESCAPE}[2K`;
const CURSOR_UP = `${ESCAPE}[A`;

// Terminals send arrows as a CSI sequence, and as SS3 once an application has asked for cursor keys.
const SEQUENCE_KEYS: Record<string, SelectKey> = { "[A": "up", "[B": "down", OA: "up", OB: "down" };

const SEQUENCE_END = /[A-Za-z~]/;

const ESCAPE_TIMEOUT_MS = 50;

export type SelectRead = {
  keys: SelectKey[];
  /** A sequence cut off by the end of the read, to be carried into the next one. */
  partial: string;
};

/**
 * One read can carry several keypresses, which is what holding a key produces, and can end
 * mid-sequence, because a keypress is three bytes that ssh and tmux may split across reads.
 * Escape alone is therefore never a key here: only the caller's timeout can tell it apart from
 * the start of an arrow.
 */
export function readSelectKeys(chunk: string): SelectRead {
  const keys: SelectKey[] = [];
  let at = 0;
  while (at < chunk.length) {
    const char = chunk[at];
    if (char === ESCAPE) {
      const rest = chunk.slice(at);
      if (rest.length === 1) return { keys, partial: rest };
      if (chunk[at + 1] === "[" || chunk[at + 1] === "O") {
        let end = at + 2;
        while (end < chunk.length && !SEQUENCE_END.test(chunk[end] ?? "")) end += 1;
        if (end === chunk.length) return { keys, partial: rest };
        keys.push(SEQUENCE_KEYS[chunk.slice(at + 1, end + 1)] ?? "none");
        at = end + 1;
        continue;
      }
      // Escape with a character behind it is a meta chord this list has no use for.
      keys.push("none");
      at += 2;
      continue;
    }
    if (char === "\r" || char === "\n") keys.push("confirm");
    else if (char === CTRL_C) keys.push("abort");
    else keys.push("none");
    at += 1;
  }
  return { keys, partial: "" };
}

/** Movement clamps at both ends, the way the in-chat picker moves. */
export function nextSelectIndex(index: number, count: number, key: SelectKey): number {
  if (key === "up") return Math.max(0, index - 1);
  if (key === "down") return Math.min(count - 1, index + 1);
  return index;
}

/** The chosen row reads as a prompt line; the rest keep the dim of the status list they mirror. */
export function formatSelectFrame(labels: string[], index: number): string[] {
  const rows = labels.map((label, row) => (row === index ? `${GLYPH_USER} ${label}` : dimText(`  ${label}`)));
  return [...rows, dimText(t("cli.select.hint"))];
}

type SelectInput = {
  isTTY?: boolean;
  setRawMode: (mode: boolean) => void;
  resume: () => void;
  pause: () => void;
  on: (event: "data", listener: (chunk: Buffer | string) => void) => void;
  off: (event: "data", listener: (chunk: Buffer | string) => void) => void;
};

type SelectIo = {
  input: SelectInput;
  write: (chunk: string) => void;
};

export async function selectOption<T>(options: SelectOption<T>[], io?: SelectIo): Promise<T | undefined> {
  const input = io?.input ?? process.stdin;
  const write = io?.write ?? writeChunk;
  if (options.length === 0 || !input.isTTY) return undefined;

  const labels = options.map((option) => option.label);
  let index = 0;

  const draw = (redraw: boolean): void => {
    const frame = formatSelectFrame(labels, index);
    const prefix = redraw ? CURSOR_UP.repeat(frame.length) : "";
    write(`${prefix}${frame.map((row) => `${CLEAR_LINE}${row}\n`).join("")}`);
  };

  return new Promise<T | undefined>((resolve) => {
    let carried = "";
    let escapeTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (value: T | undefined): void => {
      clearTimeout(escapeTimer);
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      write(SHOW_CURSOR);
      resolve(value);
    };

    const onData = (chunk: Buffer | string): void => {
      clearTimeout(escapeTimer);
      const before = index;
      const read = readSelectKeys(`${carried}${chunk.toString()}`);
      carried = read.partial;
      for (const key of read.keys) {
        if (key === "abort") {
          process.exitCode = 1;
          finish(undefined);
          return;
        }
        if (key === "confirm") {
          finish(options[index]?.value);
          return;
        }
        index = nextSelectIndex(index, options.length, key);
      }
      if (index !== before) draw(true);
      // Escape and the start of an arrow read identically; only the rest not arriving tells them apart.
      if (carried === ESCAPE) escapeTimer = setTimeout(() => finish(undefined), ESCAPE_TIMEOUT_MS);
      else if (carried.length > 0) escapeTimer = setTimeout(() => (carried = ""), ESCAPE_TIMEOUT_MS);
    };

    try {
      write(HIDE_CURSOR);
      draw(false);
      input.setRawMode(true);
      input.resume();
      input.on("data", onData);
    } catch (error) {
      finish(undefined);
      throw error;
    }
  });
}
