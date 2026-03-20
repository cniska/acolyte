/** Default column count when stdout has no TTY dimensions. */
export const DEFAULT_COLUMNS = 120;

const ESC = "\x1b[";

export const ansi = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  underline: `${ESC}4m`,
  inverse: `${ESC}7m`,

  fg256(code: number): string {
    return `${ESC}38;5;${code}m`;
  },
  bg256(code: number): string {
    return `${ESC}48;5;${code}m`;
  },
  fgRgb(r: number, g: number, b: number): string {
    return `${ESC}38;2;${r};${g};${b}m`;
  },
  bgRgb(r: number, g: number, b: number): string {
    return `${ESC}48;2;${r};${g};${b}m`;
  },

  cursorHide: `${ESC}?25l`,
  cursorShow: `${ESC}?25h`,
  eraseDown: `${ESC}J`,
  eraseLine: `${ESC}2K`,
  cursorTo(row: number, col: number): string {
    return `${ESC}${row + 1};${col + 1}H`;
  },
  cursorUp(n: number): string {
    return n > 0 ? `${ESC}${n}A` : "";
  },
  cursorSavePosition: "\x1b7",
  cursorRestorePosition: "\x1b8",
  syncStart: `${ESC}?2026h`,
  syncEnd: `${ESC}?2026l`,
} as const;

export const kitty = {
  enable(flags: number): string {
    return `${ESC}>${flags}u`;
  },
  disable: `${ESC}<u`,
} as const;

const NAMED_COLORS: Record<string, number> = {
  black: 0,
  red: 1,
  green: 2,
  yellow: 3,
  blue: 4,
  magenta: 5,
  cyan: 6,
  white: 7,
  gray: 8,
  grey: 8,
  blackBright: 8,
  redBright: 9,
  greenBright: 10,
  yellowBright: 11,
  blueBright: 12,
  magentaBright: 13,
  cyanBright: 14,
  whiteBright: 15,
};

function parseHex(hex: string): [number, number, number] | null {
  if (!hex.startsWith("#")) return null;
  const h = hex.slice(1);
  if (h.length === 3) {
    const r = Number.parseInt(`${h[0]}${h[0]}`, 16);
    const g = Number.parseInt(`${h[1]}${h[1]}`, 16);
    const b = Number.parseInt(`${h[2]}${h[2]}`, 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [r, g, b];
  }
  if (h.length === 6) {
    const r = Number.parseInt(h.slice(0, 2), 16);
    const g = Number.parseInt(h.slice(2, 4), 16);
    const b = Number.parseInt(h.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

export function colorToFg(color: string): string {
  const named = NAMED_COLORS[color] ?? NAMED_COLORS[color.toLowerCase()];
  if (named !== undefined) {
    return named < 8 ? `${ESC}${30 + named}m` : `${ESC}${90 + named - 8}m`;
  }
  const hex = parseHex(color);
  if (hex) return ansi.fgRgb(hex[0], hex[1], hex[2]);
  return "";
}

export function colorToBg(color: string): string {
  const named = NAMED_COLORS[color] ?? NAMED_COLORS[color.toLowerCase()];
  if (named !== undefined) {
    return named < 8 ? `${ESC}${40 + named}m` : `${ESC}${100 + named - 8}m`;
  }
  const hex = parseHex(color);
  if (hex) return ansi.bgRgb(hex[0], hex[1], hex[2]);
  return "";
}
