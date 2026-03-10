import { z } from "zod";

export function domainIdSchema(prefix: string): z.ZodString {
  return z.string().regex(new RegExp(`^${prefix}_[a-z0-9]+$`));
}
