import { z } from "zod";

export const oauthTokenSetSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().int(),
  accountId: z.string().min(1),
});
export type OAuthTokenSet = z.infer<typeof oauthTokenSetSchema>;

export const oauthProviderSchema = z.enum(["openai"]);
export type OAuthProvider = z.infer<typeof oauthProviderSchema>;

export const oauthStoreSchema = z.object({
  version: z.literal(1),
  openai: oauthTokenSetSchema.optional(),
});
export type OAuthStore = z.infer<typeof oauthStoreSchema>;

export const OAUTH_STORE_VERSION = 1 as const;
