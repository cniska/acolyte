import { describe, expect, test } from "bun:test";
import { setLocale, type TranslationKey, t } from "../i18n";
import type { Part } from "./catalog-contract";
import { LOCALES, TRANSLATIONS } from "./generated/catalogs";
import { argNames } from "./message-parser";

function placeholdersOf(parts: Part[]): string[] {
  return [...argNames(parts)];
}

// Bun's `prompt()` writes a space after the question it is given; `promptHidden` writes the question
// exactly as given. A message going to the wrong one prints a doubled space or none at all.
const SPACED_BY_PROMPT: TranslationKey[] = [
  "cli.auth.override.confirm",
  "cli.auth.subscription.override.confirm",
  "cli.login.prompt.url",
];

const SPACED_BY_MESSAGE: TranslationKey[] = ["cli.auth.prompt.api_key", "cli.login.prompt.token"];

function render(locale: (typeof LOCALES)[number], key: TranslationKey): string {
  setLocale(locale);
  const parts = (TRANSLATIONS[locale] as Record<string, Part[]>)[key] ?? [];
  const names = placeholdersOf(parts);
  const vars = Object.fromEntries(names.map((name) => [name, `<${name}>`]));
  return (t as (k: TranslationKey, v?: unknown) => string)(key, names.length ? vars : undefined);
}

describe("interactive prompts leave exactly one space before the caret", () => {
  for (const locale of LOCALES) {
    test(`${locale} lets prompt() supply the space`, () => {
      for (const key of SPACED_BY_PROMPT) {
        expect(render(locale, key), `${locale}/${key}`).not.toMatch(/\s$/);
      }
      setLocale("en");
    });

    test(`${locale} carries the space in questions written verbatim`, () => {
      for (const key of SPACED_BY_MESSAGE) {
        expect(render(locale, key), `${locale}/${key}`).toMatch(/ $/);
      }
      setLocale("en");
    });
  }
});

describe("every bundled catalog renders", () => {
  for (const locale of LOCALES) {
    const catalog = TRANSLATIONS[locale] as Record<string, Part[]>;

    test(`${locale} leaves no placeholder unfilled`, () => {
      setLocale(locale);
      const leaked: string[] = [];
      for (const key of Object.keys(catalog)) {
        const names = placeholdersOf(catalog[key]);
        for (const count of [0, 1, 2, 11, 1_000_000]) {
          const vars = Object.fromEntries(names.map((n) => [n, n === "count" ? count : `<${n}>`]));
          const rendered = (t as (k: TranslationKey, v?: unknown) => string)(
            key as TranslationKey,
            names.length ? vars : undefined,
          );
          if (/\{[A-Za-z0-9_]+\}/.test(rendered)) leaked.push(`${locale}/${key} @count=${count}: ${rendered}`);
          if (!names.includes("count")) break;
        }
      }
      expect(leaked).toEqual([]);
      setLocale("en");
    });

    test(`${locale} resolves a plural arm for every CLDR category`, () => {
      setLocale(locale);
      const rules = new Intl.PluralRules(locale);
      const plural = Object.keys(catalog).filter((k) => catalog[k].some((p) => p.kind === "plural"));
      expect(plural.length).toBeGreaterThan(0);
      for (const key of plural) {
        for (const count of [0, 1, 2, 3, 11, 100, 1_000_000]) {
          const names = placeholdersOf(catalog[key]);
          const vars = Object.fromEntries(names.map((n) => [n, n === "count" ? count : `<${n}>`]));
          const rendered = (t as (k: TranslationKey, v?: unknown) => string)(key as TranslationKey, vars);
          // A missing arm for this locale's category would fall through to an empty string.
          expect(rendered.trim(), `${key} @${count} (${rules.select(count)})`).not.toBe("");
        }
      }
      setLocale("en");
    });
  }
});
