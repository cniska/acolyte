import { z } from "zod";

export function domainIdSchema(prefix: string): z.ZodString {
  return z.string().regex(new RegExp(`^${prefix}_[a-z0-9]+$`));
}

export function remapDomainId(id: string, newPrefix: string): string {
  const separatorIndex = id.indexOf("_");
  if (separatorIndex === -1) return `${newPrefix}_${id}`;
  return `${newPrefix}_${id.slice(separatorIndex + 1)}`;
}
