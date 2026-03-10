const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&#x2F;": "/",
};

const HTML_ENTITY_PATTERN = new RegExp(Object.keys(HTML_ENTITIES).join("|"), "g");

function decodeHtmlEntities(input: string): string {
  return input.replace(HTML_ENTITY_PATTERN, (match) => HTML_ENTITIES[match] ?? match);
}

function stripHtmlTags(input: string): string {
  return decodeHtmlEntities(
    input
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  const match172 = host.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (match172) {
    const second = Number.parseInt(match172[1] ?? "0", 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function parseWebUrl(input: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error("Web fetch URL is invalid");
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") throw new Error("Web fetch only supports http/https URLs");
  if (isPrivateOrLocalHost(parsed.hostname)) throw new Error("Web fetch blocks localhost/private hosts");
  return parsed;
}

function extractHtmlText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = stripHtmlTags(titleMatch?.[1] ?? "").trim();
  const withoutHead = html.replace(/<head[\s\S]*?<\/head>/gi, " ");
  const withoutScripts = withoutHead
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  return {
    title,
    text: stripHtmlTags(withoutScripts),
  };
}

export async function fetchWeb(urlInput: string, maxChars = 5000): Promise<string> {
  const limit = Math.max(500, Math.min(12_000, maxChars));
  let current = parseWebUrl(urlInput);
  let redirects = 0;

  while (redirects <= 3) {
    let response: Response;
    try {
      response = await fetch(current.toString(), {
        redirect: "manual",
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36",
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`Request to ${current.toString()} timed out.`);
      }
      throw new Error(`Failed to fetch ${current.toString()} — site may be unreachable or URL is invalid.`);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Web fetch received redirect without location");
      current = parseWebUrl(new URL(location, current).toString());
      redirects += 1;
      continue;
    }
    if (!response.ok) throw new Error(`Web fetch failed with status ${response.status}`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const raw = await response.text();
    const rendered = contentType.includes("text/html") ? extractHtmlText(raw) : { title: "", text: raw.trim() };
    const body = rendered.text.replace(/\s+/g, " ").trim();
    if (!body) return "No textual content found.";
    const clipped = body.slice(0, limit);
    const lines: string[] = [];
    if (rendered.title) lines.push(rendered.title);
    lines.push(clipped);
    if (body.length > clipped.length) lines.push(`… clipped ${body.length - clipped.length} chars`);
    return lines.join("\n");
  }

  throw new Error("Web fetch stopped after too many redirects");
}

export async function searchWeb(query: string, maxResults = 5): Promise<string> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("Web search query cannot be empty");

  const limit = Math.max(1, Math.min(10, maxResults));
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(trimmed)}`;
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Web search failed with status ${response.status}`);
  const html = await response.text();

  const rows: Array<{ title: string; link: string; snippet: string }> = [];
  const resultBlockPattern = /<div class="result(?:.|\n|\r)*?<\/div>\s*<\/div>/g;
  const blocks = html.match(resultBlockPattern) ?? [];
  for (const block of blocks) {
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;
    const link = decodeHtmlEntities(titleMatch[1] ?? "").trim();
    const title = stripHtmlTags(titleMatch[2] ?? "");
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = stripHtmlTags(snippetMatch?.[1] ?? "");
    if (!link || !title) continue;
    rows.push({ title, link, snippet });
    if (rows.length >= limit) break;
  }

  if (rows.length === 0) return `No web results found for: ${trimmed}`;

  const output: string[] = [];
  for (const [index, row] of rows.entries()) {
    output.push(`${index + 1}. ${row.title}`);
    output.push(`   ${row.link}`);
    if (row.snippet) output.push(`   ${row.snippet}`);
  }
  return output.join("\n");
}
