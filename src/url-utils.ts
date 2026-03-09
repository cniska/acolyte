/** Strip trailing slashes from a base URL, preserving the path. */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
