import { appConfig } from "./app-config";
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

export function createTranslator(locale: TranslationLocale): Translator {
  return <K extends TranslationKey>(key: K, ...args: TranslationArgs<K>): string => {
    const vars = (args[0] ?? undefined) as Record<string, TranslationValue> | undefined;
    const templates = TRANSLATIONS[locale] ?? TRANSLATIONS.en;
    if (vars && "count" in vars && Number(vars.count) === 1) {
      const oneKey = `${key}.one` as TranslationKey;
      if (oneKey in templates) return interpolate(templates[oneKey], vars);
    }
    return interpolate(templates[key] ?? key, vars);
  };
}

export function t<K extends TranslationKey>(key: K, ...args: TranslationArgs<K>): string {
  const vars = (args[0] ?? undefined) as Record<string, TranslationValue> | undefined;
  const locale: TranslationLocale = appConfig.locale;
  const templates = TRANSLATIONS[locale] ?? TRANSLATIONS.en;
  if (vars && "count" in vars && Number(vars.count) === 1) {
    const oneKey = `${key}.one` as TranslationKey;
    if (oneKey in templates) return interpolate(templates[oneKey], vars);
  }
  return interpolate(templates[key] ?? key, vars);
}
