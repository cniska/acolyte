/**
 * The logo as braille cells, rasterized from the web assets so the terminal and the
 * site carry the same letterforms: the square `❯a` for the chat header, the full
 * `❯ acolyte` wordmark for the CLI. The chevron stays a separate column from the
 * lettering because each takes its own color, as they do in the SVG.
 */

export const BRAND_MARK_GAP = "⠀⠀";

export const BRAND_MARK_ROWS: ReadonlyArray<{ chevron: string; letter: string }> = [
  { chevron: "⠙⣿⣆⠀⠀", letter: "⠀⣾⠿⠿⢿⣷⣄" },
  { chevron: "⠀⠈⢿⣧⡀", letter: "⢀⣤⣤⣤⣤⣿⣿" },
  { chevron: "⠀⢀⣾⡟⠁", letter: "⣿⣿⠋⠁⢀⣿⣿" },
  { chevron: "⣠⣿⠏⠀⠀", letter: "⠹⢿⣷⣶⠞⣿⣿" },
];

export const BRAND_MARK_WIDTH = 5 + BRAND_MARK_GAP.length + 7;

export const BRAND_WORDMARK_GAP = "⠀⠀⠀⠀⠀";

export const BRAND_WORDMARK_ROWS: ReadonlyArray<{ chevron: string; word: string }> = [
  { chevron: "⠀⠀⠀⠀", word: "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠿⠿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢰⣶⡆" },
  { chevron: "⠹⣷⡄⠀", word: "⢠⣶⣶⣶⣶⡄⠀⠀⢀⣤⣶⣶⣶⡄⠀⠀⣠⣶⣶⣶⣄⠀⠀⠀⠀⣿⣿⠀⠀⠀⠀⣶⣦⠀⠀⢰⣶⠆⠀⣶⣾⣿⣷⣶⣦⠀⠀⣠⣴⣶⣶⣦⡀" },
  { chevron: "⠀⠘⣿⣄", word: "⢈⣤⣤⣤⣿⣿⠀⠀⣾⣿⠁⠀⠀⠁⠀⢸⣿⡏⠀⠘⣿⣇⠀⠀⠀⣿⣿⠀⠀⠀⠀⠘⣿⣇⢀⣿⡟⠀⠀⠀⢸⣿⡇⠀⠀⠀⢰⣿⣯⣤⣤⣿⣿" },
  { chevron: "⠀⣰⡿⠃", word: "⣿⣿⠉⠉⣿⣿⠀⠀⢿⣿⡀⠀⠀⡀⠀⢸⣿⣇⠀⢠⣿⡏⠀⠀⠀⣿⣿⠀⠀⠀⠀⠀⢹⣿⣾⡿⠁⠀⠀⠀⢸⣿⡇⠀⠀⠀⠸⣿⣏⠉⠉⠉⣉" },
  { chevron: "⠼⠟⠁⠀", word: "⠻⠿⠷⠟⠿⠿⠀⠀⠈⠻⠿⠿⠿⠇⠀⠀⠙⠿⠿⠿⠛⠀⠀⠀⠀⠙⠿⠿⠿⠇⠀⠀⠀⣻⣿⠃⠀⠀⠀⠀⠈⠻⠿⠿⠿⠀⠀⠙⠿⠿⠿⠿⠟" },
  { chevron: "⠀⠀⠀⠀", word: "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣴⣶⣿⠏" },
];
