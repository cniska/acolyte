// A ceiling rather than a target: the widest surface showing a title is the dashboard's session
// table, which fits roughly this much before it has to scroll. Prompt-derived titles are shorter
// than this on average, so the limit only bites on the long ones.
const MAX_LENGTH = 60;

/**
 * The name a session takes from its first prompt, ending on a whole word.
 *
 * Cutting on the character would leave a title severed mid-word, which reads as a rendering fault
 * rather than a name. A single word longer than the ceiling has no boundary to retreat to and is
 * cut where it stands.
 */
export function sessionTitleFromPrompt(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  if (collapsed.length <= MAX_LENGTH) return collapsed;

  const clipped = collapsed.slice(0, MAX_LENGTH);
  const lastBoundary = clipped.lastIndexOf(" ");
  return lastBoundary > 0 ? clipped.slice(0, lastBoundary) : clipped;
}
