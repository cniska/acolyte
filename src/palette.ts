export const palette = {
  // Brand
  brand: "#A56EFF",
  mascot: "#2A1D4A",
  mascotEyes: "#FFD84D",

  // Text — one gray + one dim, borrowed from Claude Code, shared across the UI.
  text: "white",
  gray: "#999999", // secondary content (Claude Code promptBorder / shimmer bright)
  dim: "#666666", // dimmest ambient detail (Claude Code inactive)

  // Diff
  diffAdd: "#0d1f0d",
  diffRemove: "#1f0d0d",
  diffAddText: "#4a9a4a",
  diffRemoveText: "#9a4a4a",

  userBand: "#1c1c26",

  // Semantic
  green: "green",
  red: "red",
  blue: "blue",
  yellow: "yellow",
  cyan: "cyan",
  magenta: "magenta",
  success: "green",
  error: "red",
  cancelled: "#E5A84B",
  running: "#4DA3FF",
  queued: "#F5C451",
  accepted: "#4DD2FF",
} as const;
