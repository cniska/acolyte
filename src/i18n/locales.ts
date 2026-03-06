import { EN_MESSAGES } from "./en";

export type TranslationCatalog = {
  [Key in keyof typeof EN_MESSAGES]: string;
};

export const TRANSLATIONS = {
  en: EN_MESSAGES,
} as const satisfies Record<string, TranslationCatalog>;

export type TranslationLocale = keyof typeof TRANSLATIONS;
