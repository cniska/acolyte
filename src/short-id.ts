const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function createId(size = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let id = "";
  for (let i = 0; i < size; i++) {
    id += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  }
  return id;
}
