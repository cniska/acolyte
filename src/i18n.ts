import type { EN_MESSAGES } from "./i18n/en";
import { TRANSLATIONS, type TranslationLocale } from "./i18n/locales";

export type TranslationValue = string | number | boolean;
export type TranslationKey = keyof typeof EN_MESSAGES;

type ExtractTemplateVars<T extends string> = T extends `${string}{${infer Name}}${infer Rest}`
  ? Name | ExtractTemplateVars<Rest>
  : never;

type TranslationVarsFor<K extends TranslationKey> = [ExtractTemplateVars<(typeof EN_MESSAGES)[K]>] extends [never]
  ? never
  : {
      [Name in ExtractTemplateVars<(typeof EN_MESSAGES)[K]>]: TranslationValue;
    };

type TranslationArgs<K extends TranslationKey> = [TranslationVarsFor<K>] extends [never] ? [] : [TranslationVarsFor<K>];

export type Translator = <K extends TranslationKey>(key: K, ...args: TranslationArgs<K>) => string;

function interpolate(template: string, vars?: Record<string, TranslationValue>): string {
  if (!vars) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, name: string) => {
    const value = vars[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

function translate(templates: Record<string, string>, key: string, vars?: Record<string, TranslationValue>): string {
  if (vars && "count" in vars && Number(vars.count) === 1) {
    const oneKey = `${key}.one`;
    if (oneKey in templates) return interpolate(templates[oneKey], vars);
  }
  return interpolate(templates[key] ?? key, vars);
}

export function createTranslator(locale: TranslationLocale): Translator {
  const templates = TRANSLATIONS[locale] ?? TRANSLATIONS.en;
  return (key, ...args) => translate(templates, key, args[0] as Record<string, TranslationValue> | undefined);
}

let activeLocale: TranslationLocale = "en";

export function setLocale(locale: TranslationLocale): void {
  activeLocale = locale;
}

export function t<K extends TranslationKey>(key: K, ...args: TranslationArgs<K>): string {
  return translate(
    TRANSLATIONS[activeLocale] ?? TRANSLATIONS.en,
    key,
    args[0] as Record<string, TranslationValue> | undefined,
  );
}

/** Translate a dynamic key without compile-time key checking. Falls back to the key itself when not found. */
export function tDynamic(key: string, vars?: Record<string, TranslationValue>): string {
  return translate(TRANSLATIONS[activeLocale] ?? TRANSLATIONS.en, key, vars);
}
