/** One ladder for every count the user reads, so the same number never renders two ways. */
export function formatCompactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const thousands = rung(n / 1000);
    // Rounding carries a figure onto the next rung: 999_500 is 1000k, which is the four-digit
    // reading this ladder exists to avoid, and 1.0M says the same thing.
    return thousands === "1000" ? `${rung(n / 1_000_000)}M` : `${thousands}k`;
  }
  return `${rung(n / 1_000_000)}M`;
}

/** A rung carries one decimal until three digits would read it precisely enough without. */
function rung(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded < 100 ? rounded.toFixed(1) : String(Math.round(value));
}
