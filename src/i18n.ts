import type { Part, PluralCategory } from "./i18n/catalog-contract";
import { type MessageArgs, TRANSLATIONS } from "./i18n/generated/catalogs";
import type { TranslationLocale } from "./i18n/locales";

export type TranslationValue = string | number | boolean;
export type TranslationKey = keyof MessageArgs;

type TranslationArgs<K extends TranslationKey> = [MessageArgs[K]] extends [never] ? [] : [MessageArgs[K]];

let activeLocale: TranslationLocale = "en";
const pluralRules = new Map<string, Intl.PluralRules>();

function rulesFor(locale: string): Intl.PluralRules {
  const cached = pluralRules.get(locale);
  if (cached) return cached;
  const rules = new Intl.PluralRules(locale);
  pluralRules.set(locale, rules);
  return rules;
}

function render(parts: Part[], vars: Record<string, TranslationValue> | undefined, locale: string): string {
  let out = "";
  for (const part of parts) {
    if (part.kind === "text") {
      out += part.value;
      continue;
    }
    if (part.kind === "arg") {
      const value = vars?.[part.name];
      out += value === undefined ? `{${part.name}}` : String(value);
      continue;
    }
    const category = rulesFor(locale).select(Number(vars?.[part.name] ?? 0)) as PluralCategory;
    out += render(part.arms[category] ?? part.arms.other ?? [], vars, locale);
  }
  return out;
}

export function setLocale(locale: TranslationLocale): void {
  activeLocale = locale;
}

export function t<K extends TranslationKey>(key: K, ...args: TranslationArgs<K>): string {
  return render(TRANSLATIONS[activeLocale][key], args[0] as Record<string, TranslationValue> | undefined, activeLocale);
}

/** Translate a key chosen at runtime. Falls back to the key itself when the catalog has no such message. */
export function tDynamic(key: string, vars?: Record<string, TranslationValue>): string {
  const parts = (TRANSLATIONS[activeLocale] as Record<string, Part[]>)[key];
  return parts ? render(parts, vars, activeLocale) : key;
}
