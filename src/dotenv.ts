export type DotenvEntry = {
  key: string;
  value: string;
};

export function parseDotenv(content: string): DotenvEntry[] {
  const entries: DotenvEntry[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key.length > 0) entries.push({ key, value });
  }
  return entries;
}

export function serializeDotenv(entries: DotenvEntry[]): string {
  if (entries.length === 0) return "";
  return `${entries.map((e) => `${e.key}=${e.value}`).join("\n")}\n`;
}

export function getDotenvValue(entries: DotenvEntry[], key: string): string | undefined {
  const entry = entries.find((e) => e.key === key);
  return entry?.value || undefined;
}

export function upsertDotenvValue(content: string, key: string, value: string): string {
  const lines = content.length > 0 ? content.split(/\r?\n/) : [];
  const matcher = new RegExp(`^\\s*${key}\\s*=`);
  const nextLines: string[] = [];
  let replaced = false;

  for (const line of lines) {
    if (matcher.test(line)) {
      if (!replaced) {
        nextLines.push(`${key}=${value}`);
        replaced = true;
      }
      continue;
    }
    nextLines.push(line);
  }

  if (!replaced) nextLines.push(`${key}=${value}`);
  const cleaned = nextLines.filter((line, index, arr) => !(index === arr.length - 1 && line.trim() === ""));
  return `${cleaned.join("\n")}\n`;
}

export function removeDotenvKey(content: string, key: string): string {
  const lines = content.split(/\r?\n/);
  const matcher = new RegExp(`^\\s*${key}\\s*=`);
  const filtered = lines.filter((line) => !matcher.test(line));
  const cleaned = filtered.filter((line, index, arr) => !(index === arr.length - 1 && line.trim() === ""));
  return cleaned.length > 0 ? `${cleaned.join("\n")}\n` : "";
}
