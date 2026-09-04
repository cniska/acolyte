/**
 * Vertical gradients for the CLI wordmark, swept top to bottom so the mark reads as lit from
 * above rather than flat-filled, on the monochrome ramp of the lockup at app.acolyte.sh. The
 * chat header's mark is four rows — too short for a sweep to read — and takes flat brand color.
 */

import { palette } from "./palette";

export type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const MONO_STOPS: ReadonlyArray<Rgb> = [palette.markInk, palette.markMuted].map(hexToRgb);

/** One stop deeper than `MONO_STOPS` at every position, so the caret sweeps but stays behind the name. */
export const MONO_CARET_STOPS: ReadonlyArray<Rgb> = [palette.markMuted, palette.dim].map(hexToRgb);

/** Color at normalized position `t` along a gradient, clamped to the end stops. */
export function gradientRgb(t: number, stops: ReadonlyArray<Rgb>): Rgb {
  const clamped = Math.min(1, Math.max(0, t));
  const segment = clamped * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(segment));
  const fraction = segment - index;
  const from = stops[index];
  const to = stops[index + 1];
  return [
    Math.round(from[0] + (to[0] - from[0]) * fraction),
    Math.round(from[1] + (to[1] - from[1]) * fraction),
    Math.round(from[2] + (to[2] - from[2]) * fraction),
  ];
}

/** Position down the mark for a row, so the sweep runs top to bottom. */
export function verticalPosition(y: number, height: number): number {
  return y / Math.max(1, height - 1);
}

export const BRAILLE_BLANK = "⠀";
