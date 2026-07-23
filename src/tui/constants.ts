/** Default column count when stdout has no TTY dimensions. */
export const DEFAULT_COLUMNS = 120;

/** Default rows when stdout has no TTY dimensions. Must match the renderer's freeze fold,
 *  else the promotion boundary and the fold diverge and duplicate lines. */
export const DEFAULT_ROWS = 24;

/** Fallback terminal width for layout calculations. */
export const DEFAULT_TERMINAL_WIDTH = 96;
