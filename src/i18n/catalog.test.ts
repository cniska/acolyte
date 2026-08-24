import { describe, expect, test } from "bun:test";
import { setLocale, type TranslationKey, t } from "../i18n";
import type { Part } from "./catalog-contract";
import { LOCALES, TRANSLATIONS } from "./generated/catalogs";
import { argNames } from "./message-parser";

function placeholdersOf(parts: Part[]): string[] {
  return [...argNames(parts)];
}

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
