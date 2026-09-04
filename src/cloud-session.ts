import { z } from "zod";
import { decodeTokenExpiry } from "./credentials";

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
  private refreshTokenRefused = false;

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
    if (!this.renewal || this.refreshTokenRefused) return false;
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

  /**
   * Never throws: renewal is what Acolyte tries before giving up, so a failure here must leave the
   * request that asked for it to fail on its own terms — with the cloud's status and its guidance.
   */
  private async exchange(renewal: CloudRenewal): Promise<boolean> {
    const send = this.fetchFn ?? fetch;
    let response: Response;
    try {
      response = await send(`${this.base}${REFRESH_ROUTE}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: renewal.refreshToken }),
      });
    } catch {
      return false;
    }

    // A refused refresh token stays refused, so one dead credential does not put a failed exchange
    // in front of every later call. A network failure is not an answer and is left to be retried.
    if (response.status === 401 || response.status === 403) {
      this.refreshTokenRefused = true;
      return false;
    }
    if (!response.ok) return false;

    const parsed = refreshResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) return false;

    this.token = parsed.data.token;

    // The token is already in hand and the request it renews can go; a credentials file that cannot
    // be written costs this machine the next process's head start, not this call.
    try {
      await renewal.persistToken(parsed.data.token);
    } catch {}
    return true;
  }
}
