import { z } from "zod";

export const isoDateTimeSchema = z.string().datetime();
export type IsoDateTimeString = z.infer<typeof isoDateTimeSchema>;

export function isIsoDateTimeString(value: unknown): value is IsoDateTimeString {
  return isoDateTimeSchema.safeParse(value).success;
}

export function nowIso(): IsoDateTimeString {
  return new Date().toISOString();
}
