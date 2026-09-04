/**
 * Diagonal brand gradient for the braille marks. The stops are the site's own
 * purples, swept top-left to bottom-right so the mark reads as lit from one corner
 * rather than flat-filled.
 */

import { palette } from "./palette";

export type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const STOPS: ReadonlyArray<Rgb> = [palette.brandDeep, palette.brand, palette.brandLight].map(hexToRgb);

/** Color at normalized position `t` along the gradient, clamped to the end stops. */
export function gradientRgb(t: number): Rgb {
  const clamped = Math.min(1, Math.max(0, t));
  const segment = clamped * (STOPS.length - 1);
  const index = Math.min(STOPS.length - 2, Math.floor(segment));
  const fraction = segment - index;
  const from = STOPS[index];
  const to = STOPS[index + 1];
  return [
    Math.round(from[0] + (to[0] - from[0]) * fraction),
    Math.round(from[1] + (to[1] - from[1]) * fraction),
    Math.round(from[2] + (to[2] - from[2]) * fraction),
  ];
}

/** Position along the diagonal for a cell, so both axes contribute equally. */
export function diagonalPosition(x: number, y: number, width: number, height: number): number {
  const xSpan = Math.max(1, width - 1);
  const ySpan = Math.max(1, height - 1);
  return (x / xSpan + y / ySpan) / 2;
}

export const BRAILLE_BLANK = "⠀";
