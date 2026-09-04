/**
 * The logo as braille cells: the square `❯a` for the chat header, the full `❯ acolyte` wordmark
 * for the CLI, both at a 16-pixel x-height. The caret stays a separate column from the lettering
 * because each takes its own color, as they do in the lockup at app.acolyte.sh.
 */

/** The `❯` caret, spanning the 16-pixel x-height band; both marks draw it from here. */
export const BRAND_CARET_ROWS: ReadonlyArray<string> = ["⠹⣿⣆⠀", "⠀⠹⣿⣆", "⠀⣰⣿⠏", "⣰⣿⠏⠀"];

const BRAND_CARET_BLANK_ROW = "⠀⠀⠀⠀";

/** Three cells, so the caret stands off the letter exactly as it does in the wordmark. */
export const BRAND_MARK_GAP = "⠀⠀⠀";

const BRAND_MARK_LETTER_ROWS = ["⢠⣶⡿⠿⢿⣶⡄", "⢀⣤⣤⣤⣤⣿⣿", "⣾⣿⠋⠁⢀⣿⣿", "⠸⢿⣷⣶⠞⣿⣿"];

export const BRAND_MARK_ROWS: ReadonlyArray<{ chevron: string; letter: string }> = BRAND_MARK_LETTER_ROWS.map(
  (letter, row) => ({ chevron: BRAND_CARET_ROWS[row], letter }),
);

export const BRAND_MARK_WIDTH = BRAND_CARET_BLANK_ROW.length + BRAND_MARK_GAP.length + 7;

export const BRAND_WORDMARK_GAP = "⠀⠀";

/** The caret sits in the wordmark's x-height band, blank above the ascenders and below the tail. */
const BRAND_WORDMARK_CARET_ROWS = [
  BRAND_CARET_BLANK_ROW,
  BRAND_CARET_BLANK_ROW,
  BRAND_CARET_ROWS[0],
  BRAND_CARET_ROWS[1],
  BRAND_CARET_ROWS[2],
  BRAND_CARET_ROWS[3],
  BRAND_CARET_BLANK_ROW,
  BRAND_CARET_BLANK_ROW,
];

const BRAND_WORDMARK_WORD_ROWS = [
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣤⣤⣤⡄",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⠛⢻⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿",
  "⠀⢠⣶⡿⠿⢿⣶⡄⠀⠀⣴⣾⠿⠿⣷⣦⠀⠀⣴⣾⠿⠿⣷⣦⠀⠀⢸⣿⡇⠀⠀⠀⠘⣿⣿⡄⠀⠀⣼⣿⡟⠀⠿⠿⣿⣿⠿⠿⠿⠀⠀⣴⣾⠿⠿⣷⣦",
  "⠀⢀⣤⣤⣤⣤⣿⣿⠀⢸⣿⡇⠀⠀⠀⠀⠀⢸⣿⡇⠀⠀⢸⣿⡇⠀⢸⣿⡇⠀⠀⠀⠀⠘⣿⣿⡄⣼⣿⡟⠀⠀⠀⠀⣿⣿⠀⠀⠀⠀⢸⣿⣧⣤⣤⣼⣿⡇",
  "⠀⣾⣿⠋⠁⢀⣿⣿⠀⢸⣿⡇⠀⠀⠀⠀⠀⢸⣿⡇⠀⠀⢸⣿⡇⠀⢸⣿⣇⠀⠀⠀⠀⠀⠘⣿⣿⣿⡟⠀⠀⠀⠀⠀⣿⣿⡀⠀⠀⠀⢸⣿⡏⠉⠉⠉⠉⠁",
  "⠀⠸⢿⣷⣶⠞⣿⣿⠀⠀⠻⢿⣶⣶⡿⠟⠀⠀⠻⢿⣶⣶⡿⠟⠀⠀⠘⠿⣿⣿⣿⡇⠀⠀⠀⣼⣿⡟⠀⠀⠀⠀⠀⠀⠻⢿⣿⣿⣿⠀⠀⠻⢿⣶⣶⡿⠟",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣤⣼⣿⡟",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⠛⠛⠉",
];

/** The lettering's right edge; the CLI sets the version flush to it. */
export const BRAND_WORDMARK_WIDTH = Math.max(...BRAND_WORDMARK_WORD_ROWS.map((row) => row.length));

export const BRAND_WORDMARK_ROWS: ReadonlyArray<{ chevron: string; word: string }> = BRAND_WORDMARK_WORD_ROWS.map(
  (word, row) => ({ chevron: BRAND_WORDMARK_CARET_ROWS[row] ?? BRAND_CARET_BLANK_ROW, word }),
);
