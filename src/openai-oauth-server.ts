import { CodedError } from "./coded-error";
import { OPENAI_OAUTH_REDIRECT_PORT } from "./openai-oauth-contract";

export type OAuthCallbackServer = {
  result: Promise<{ code: string }>;
  stop: () => Promise<void>;
};

export const OAUTH_SERVER_ERROR_CODE = "E_OAUTH_CALLBACK_SERVER";
export type OAuthServerErrorKind = "port_in_use" | "timeout" | "callback_error";

const TIMEOUT_MS = 120_000;
const CALLBACK_PATH = "/auth/callback";

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Acolyte</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0a0a0a;color:#fafafa}
.card{text-align:center}h1{font-size:2.25rem;font-weight:600;margin:0 0 12px}p{color:#737373;margin:8px 0}</style></head>
<body><div class="card"><h1>Authenticated</h1><p>You can close this tab and return to the terminal.</p></div></body></html>`;

const ERROR_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Acolyte</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0a0a0a;color:#fafafa}
.card{text-align:center}h1{font-size:2.25rem;font-weight:600;margin:0 0 12px}p{color:#737373;margin:8px 0}code{font-family:ui-monospace,monospace;background:#171717;padding:2px 6px;border-radius:4px;color:#d4d4d4}</style></head>
<body><div class="card"><h1>Something went wrong</h1><p>The authorization failed or expired.</p><p>Run <code>acolyte auth openai</code> to try again.</p></div></body></html>`;

export type CallbackOutcome = { ok: true; code: string } | { ok: false; message: string };

export function classifyCallback(url: URL, expectedState: string): CallbackOutcome {
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (error) return { ok: false, message: error };
  if (!state || state !== expectedState) return { ok: false, message: "state mismatch" };
  if (!code) return { ok: false, message: "missing authorization code" };
  return { ok: true, code };
}

function callbackError(message: string): CodedError<string, undefined, OAuthServerErrorKind> {
  return new CodedError(OAUTH_SERVER_ERROR_CODE, message, { kind: "callback_error" });
}

export function startOAuthCallbackServer(expectedState: string): OAuthCallbackServer {
  let resolveResult!: (value: { code: string }) => void;
  let rejectResult!: (reason: Error) => void;
  const result = new Promise<{ code: string }>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  let closePromise: Promise<void> | undefined;
  const stop = () => {
    if (!closePromise) {
      clearTimeout(timeout);
      closePromise = Promise.resolve(server.stop(true));
    }
    return closePromise;
  };

  const timeout = setTimeout(() => {
    rejectResult(new CodedError(OAUTH_SERVER_ERROR_CODE, "timeout", { kind: "timeout" }));
    void stop();
  }, TIMEOUT_MS);

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      port: OPENAI_OAUTH_REDIRECT_PORT,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== CALLBACK_PATH) return new Response("Not found", { status: 404 });

        const outcome = classifyCallback(url, expectedState);
        clearTimeout(timeout);
        if (!outcome.ok) {
          rejectResult(callbackError(outcome.message));
          setTimeout(stop, 100);
          return new Response(ERROR_HTML, { status: 400, headers: { "Content-Type": "text/html" } });
        }
        resolveResult({ code: outcome.code });
        setTimeout(stop, 100);
        return new Response(SUCCESS_HTML, { headers: { "Content-Type": "text/html" } });
      },
    });
  } catch (cause) {
    clearTimeout(timeout);
    throw new CodedError<string, undefined, OAuthServerErrorKind>(
      OAUTH_SERVER_ERROR_CODE,
      `port ${OPENAI_OAUTH_REDIRECT_PORT} in use`,
      { kind: "port_in_use", cause },
    );
  }

  return { result, stop };
}
