export const CLI_TOOL_OUTPUT_LIMITS = {
  files: 5,
  run: 5,
  read: 48,
  diff: 64,
  status: 6,
} as const;

/** A tail of content rows, sized to give its newest line time on screen. The line saying what was
 *  left out is not one of them. */
export const OUTPUT_WINDOW_ROWS = 10;

/** The renderer's paint throttle, and so the finest granularity any reveal can have: nothing can
 *  appear sooner than the next paint. Every pace below is a whole number of these. */
export const REVEAL_FRAME_MS = 32;
