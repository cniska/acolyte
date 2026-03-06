import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { EN_MESSAGES } from "./en";

export type TranslationCatalog = {
  [Key in keyof typeof EN_MESSAGES]: string;
};

function isTranslationCatalog(value: unknown): value is TranslationCatalog {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(EN_MESSAGES) as Array<keyof typeof EN_MESSAGES>) {
    if (typeof record[key] !== "string") return false;
  }
  return true;
}

function loadTranslations(): Record<string, TranslationCatalog> {
  const loaded: Record<string, TranslationCatalog> = { en: EN_MESSAGES };
  const localeDir = join(import.meta.dir, "locales");
  if (!existsSync(localeDir)) return loaded;
  for (const name of readdirSync(localeDir)) {
    if (!name.endsWith(".json")) continue;
    const locale = name.slice(0, -".json".length);
    if (!locale || locale === "en") continue;
    try {
      const parsed = JSON.parse(readFileSync(join(localeDir, name), "utf8")) as unknown;
      if (isTranslationCatalog(parsed)) loaded[locale] = parsed;
    } catch {
      // Ignore invalid locale files and continue with valid catalogs.
    }
  }
  return loaded;
}

export const TRANSLATIONS = loadTranslations();

export type TranslationLocale = string;
const LOCALE_TAG_REGEX = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
export const translationLocaleSchema = z
  .string()
  .regex(LOCALE_TAG_REGEX, "Invalid locale")
  .refine((value): value is TranslationLocale => value in TRANSLATIONS, "Invalid locale");
