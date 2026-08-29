/** One ladder for every count the user reads, so the same number never renders two ways. */
export function formatCompactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    const rounded = Math.round(k * 10) / 10;
    return rounded < 100 ? `${rounded.toFixed(1)}k` : `${Math.round(k)}k`;
  }
  const m = n / 1_000_000;
  const rounded = Math.round(m * 10) / 10;
  return rounded < 100 ? `${rounded.toFixed(1)}M` : `${Math.round(m)}M`;
}
