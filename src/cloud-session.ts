import { z } from "zod";
import { CodedError } from "./coded-error";
import { decodeTokenExpiry } from "./credentials";
import { CLOUD_ERROR_CODES } from "./error-contract";

const REFRESH_ROUTE = "/api/v1/auth/refresh";

/** Renew this far ahead of expiry, so a token cannot lapse between the check and the request. */
const RENEW_SKEW_MS = 60_000;

const refreshResponseSchema = z.object({ token: z.string().min(1) });

/** What a session needs to buy its next access token; without it the token stands until it expires. */
export type CloudRenewal = {
  refreshToken: string;
  persistToken: (token: string) => Promise<void>;
};

export type CloudSessionOptions = {
  baseUrl: string;
  token: string;
  renewal?: CloudRenewal;
  fetchFn?: typeof fetch;
  now?: () => number;
};

/**
 * Holds the access token the cloud client sends and buys the next one before it expires. The refresh
 * token outlives the access token by months and the exchange does not rotate it, so a failed renewal
 * costs nothing but the attempt.
 */
export class CloudSession {
  private readonly base: string;
  private readonly renewal: CloudRenewal | undefined;
  private readonly fetchFn: typeof fetch | undefined;
  private readonly now: () => number;
  private token: string;
  private inFlight: Promise<boolean> | null = null;

  constructor(options: CloudSessionOptions) {
    this.base = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.renewal = options.renewal;
    this.fetchFn = options.fetchFn;
    this.now = options.now ?? Date.now;
  }

  /** The token to send, renewed first when it is spent. */
  async accessToken(): Promise<string> {
    if (this.isExpiring()) await this.renew();
    return this.token;
  }

  /**
   * Trades the refresh token for a new access token. Concurrent callers share one exchange, so a
   * turn that fans out across the API asks the cloud once.
   */
  async renew(): Promise<boolean> {
    if (!this.renewal) return false;
    this.inFlight ??= this.exchange(this.renewal).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private isExpiring(): boolean {
    const expiry = decodeTokenExpiry(this.token);
    if (expiry === undefined) return false;
    return expiry * 1000 - this.now() <= RENEW_SKEW_MS;
  }

  private async exchange(renewal: CloudRenewal): Promise<boolean> {
    const send = this.fetchFn ?? fetch;
    const response = await send(`${this.base}${REFRESH_ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: renewal.refreshToken }),
    });
    if (!response.ok) return false;

    const parsed = refreshResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new CodedError(CLOUD_ERROR_CODES.requestFailed, `Cloud API POST ${REFRESH_ROUTE} returned no token`);
    }

    this.token = parsed.data.token;
    await renewal.persistToken(parsed.data.token);
    return true;
  }
}
