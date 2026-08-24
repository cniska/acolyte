import { z } from "zod";
import { LOCALES } from "./generated/catalogs";

export type TranslationLocale = (typeof LOCALES)[number];

export const translationLocaleSchema = z.enum(LOCALES);
