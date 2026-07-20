import { z } from "zod";

export const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_OAUTH_ISSUER = "https://auth.openai.com";
export const OPENAI_OAUTH_REDIRECT_PORT = 1455;
export const OPENAI_OAUTH_REDIRECT_URI = `http://localhost:${OPENAI_OAUTH_REDIRECT_PORT}/auth/callback`;
export const OPENAI_OAUTH_SCOPE = "openid profile email offline_access";
export const OPENAI_OAUTH_ORIGINATOR = "codex_cli_rs";

export const oauthTokenResponseSchema = z.object({
  id_token: z.string(),
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
});
export type OAuthTokenResponse = z.infer<typeof oauthTokenResponseSchema>;

const chatgptAccountClaimSchema = z.looseObject({
  chatgpt_account_id: z.string().optional(),
});

export const oauthJwtClaimsSchema = z.looseObject({
  chatgpt_account_id: z.string().optional(),
  "https://api.openai.com/auth": chatgptAccountClaimSchema.optional(),
  organizations: z.array(z.looseObject({ id: z.string() })).optional(),
});
export type OAuthJwtClaims = z.infer<typeof oauthJwtClaimsSchema>;
