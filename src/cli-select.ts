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

export function selectKeyFor(chunk: string): SelectKey {
  if (chunk === `${ESCAPE}[A`) return "up";
  if (chunk === `${ESCAPE}[B`) return "down";
  if (chunk === "\r" || chunk === "\n") return "confirm";
  if (chunk === ESCAPE) return "cancel";
  if (chunk === CTRL_C) return "abort";
  return "none";
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
    const finish = (value: T | undefined): void => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      write(SHOW_CURSOR);
      resolve(value);
    };

    const onData = (chunk: Buffer | string): void => {
      const key = selectKeyFor(chunk.toString());
      if (key === "abort") {
        process.exitCode = 1;
        finish(undefined);
        return;
      }
      if (key === "cancel") {
        finish(undefined);
        return;
      }
      if (key === "confirm") {
        finish(options[index]?.value);
        return;
      }
      const moved = nextSelectIndex(index, options.length, key);
      if (moved === index) return;
      index = moved;
      draw(true);
    };

    write(HIDE_CURSOR);
    draw(false);
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}
