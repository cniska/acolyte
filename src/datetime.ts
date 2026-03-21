import { z } from "zod";
import { t } from "./i18n";

export const isoDateTimeSchema = z.iso.datetime();
export type IsoDateTimeString = z.infer<typeof isoDateTimeSchema>;

export function isIsoDateTimeString(value: unknown): value is IsoDateTimeString {
  return isoDateTimeSchema.safeParse(value).success;
}

export function nowIso(): IsoDateTimeString {
  return new Date().toISOString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (seconds === 60) return `${minutes + 1}m 0s`;
  return `${minutes}m ${seconds}s`;
}

export function parseSince(value: string, now?: number): Date | undefined {
  const match = value.match(/^(\d+)([mhd])$/);
  if (!match) return undefined;
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2];
  const ref = now ?? Date.now();
  switch (unit) {
    case "m":
      return new Date(ref - amount * 60_000);
    case "h":
      return new Date(ref - amount * 3_600_000);
    case "d":
      return new Date(ref - amount * 86_400_000);
    default:
      return undefined;
  }
}

export function formatRelativeTime(iso: string, now?: number): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const seconds = Math.floor(((now ?? Date.now()) - date.getTime()) / 1000);
  if (seconds < 60) return t("chat.relative_time.just_now");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("chat.relative_time.minutes_ago", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("chat.relative_time.hours_ago", { count: hours });
  const days = Math.floor(hours / 24);
  return t("chat.relative_time.days_ago", { count: days });
}
