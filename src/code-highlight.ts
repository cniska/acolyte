import type { Element, Root, RootContent } from "hast";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";
import type { TerminalSpan } from "./terminal-scene-contract";
import type { TerminalStyleRole } from "./terminal-theme";

// The single seam where the highlighter (lowlight, the highlight.js engine behind a stable hast
// contract) enters the codebase. Returns spans-per-source-line tagged with bounded `syntax-*` roles;
// never emits ANSI, never imports the theme — the renderer stays sole author of stdout and the
// fixed theme stays the only place a role becomes a color.
const lowlight = createLowlight({
  bash,
  c,
  cpp,
  css,
  diff,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  markdown,
  php,
  python,
  ruby,
  rust,
  scss,
  sql,
  typescript,
  xml,
  yaml,
});

// Fence info string -> registered grammar. Explicit only; `highlightAuto` is never used (it flaps
// goldens). An unknown language falls back to a plain (uncolored, still line-split) render.
const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  typescript: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  node: "javascript",
  javascript: "javascript",
  json: "json",
  jsonc: "json",
  json5: "json",
  py: "python",
  python: "python",
  rs: "rust",
  rust: "rust",
  go: "go",
  golang: "go",
  sh: "bash",
  bash: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  css: "css",
  scss: "scss",
  sass: "scss",
  html: "xml",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  svelte: "xml",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  dockerfile: "dockerfile",
  docker: "dockerfile",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  "c++": "cpp",
  cxx: "cpp",
  cc: "cpp",
  hpp: "cpp",
  rb: "ruby",
  ruby: "ruby",
  php: "php",
  diff: "diff",
  patch: "diff",
};

// hljs scope (dotted, with `hljs-` prefix and sub-scope `_` suffix stripped) -> our bounded role.
// Any unlisted scope resolves to `syntax-plain` — a dedicated code-plain role, never bare `plain`,
// so a future code-block background is a single theme edit.
const SCOPE_ROLES: Record<string, TerminalStyleRole> = {
  keyword: "syntax-keyword",
  literal: "syntax-keyword",
  "variable.language": "syntax-keyword",
  "selector-tag": "syntax-keyword",
  section: "syntax-keyword",
  built_in: "syntax-type",
  type: "syntax-type",
  class: "syntax-type",
  "title.class": "syntax-type",
  "title.class.inherited": "syntax-type",
  number: "syntax-number",
  string: "syntax-string",
  regexp: "syntax-string",
  symbol: "syntax-string",
  "meta.string": "syntax-string",
  comment: "syntax-comment",
  quote: "syntax-comment",
  doctag: "syntax-comment",
  "title.function": "syntax-function",
  "title.function.invoke": "syntax-function",
  function: "syntax-function",
  title: "syntax-function",
  name: "syntax-function",
  property: "syntax-property",
  attr: "syntax-property",
  attribute: "syntax-property",
  "selector-attr": "syntax-property",
  "selector-class": "syntax-property",
  "selector-id": "syntax-property",
  meta: "syntax-meta",
  "meta.keyword": "syntax-meta",
  "meta.prompt": "syntax-meta",
  addition: "syntax-addition",
  deletion: "syntax-deletion",
};

// null (not a plain fallback) lets a caller keep its own rendering for an unknown token.
export function resolveLanguage(token: string): string | null {
  return LANGUAGE_ALIASES[token.trim().toLowerCase()] ?? null;
}

const MAX_CHARS = 20_000;
const MAX_LINES = 400;
const MEMO_LIMIT = 500;
const memo = new Map<string, TerminalSpan[][]>();

function scopeRole(element: Element): TerminalStyleRole {
  const className = element.properties?.className;
  if (!Array.isArray(className)) return "syntax-plain";
  const segments = className
    .map((cls) =>
      String(cls)
        .replace(/^hljs-/, "")
        .replace(/_+$/, ""),
    )
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return "syntax-plain";
  return SCOPE_ROLES[segments.join(".")] ?? SCOPE_ROLES[segments[0] ?? ""] ?? "syntax-plain";
}

function plainSpans(text: string): TerminalSpan[][] {
  return text.split("\n").map((line) => (line.length > 0 ? [{ text: line, role: "syntax-plain" as const }] : []));
}

// A hast text node can span multiple source lines (block comments, template literals), so split on
// "\n" — a newline ends the current physical source line — and keep every character so the spans
// reconstruct the input byte-for-byte.
function toLines(tree: Root): TerminalSpan[][] {
  const lines: TerminalSpan[][] = [];
  let current: TerminalSpan[] = [];
  const emit = (text: string, role: TerminalStyleRole) => {
    const parts = text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) {
        lines.push(current);
        current = [];
      }
      if (part.length > 0) current.push({ text: part, role });
    });
  };
  const visit = (node: RootContent, role: TerminalStyleRole) => {
    if (node.type === "text") {
      emit(node.value, role);
      return;
    }
    if (node.type === "element") {
      const childRole = scopeRole(node);
      for (const child of node.children) visit(child, childRole);
    }
  };
  for (const child of tree.children) visit(child, "syntax-plain");
  lines.push(current);
  return lines;
}

// Highlight code into spans per source line. Pure and deterministic (explicit language only) so the
// `(lang\0text)` memo is safe to freeze into scrollback. Above the size ceiling, or for an unknown
// language, it renders plain (uncolored) — the streaming tail re-highlights every frame, so the
// ceiling bounds the pathological-block cost.
export function highlightCode(text: string, lang: string): TerminalSpan[][] {
  const name = LANGUAGE_ALIASES[lang.trim().toLowerCase()];
  if (!name || text.length > MAX_CHARS || text.split("\n").length > MAX_LINES) return plainSpans(text);
  const key = `${name}\0${text}`;
  const cached = memo.get(key);
  if (cached) return cached;
  let lines: TerminalSpan[][];
  try {
    lines = toLines(lowlight.highlight(name, text));
  } catch {
    lines = plainSpans(text);
  }
  if (memo.size >= MEMO_LIMIT) memo.clear();
  memo.set(key, lines);
  return lines;
}
