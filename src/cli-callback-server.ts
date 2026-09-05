import { CodedError } from "./coded-error";
import { LOGIN_ERROR_CODES } from "./error-contract";

export type CallbackResult = {
  code: string;
};

const TIMEOUT_MS = 120_000;

export const DEFAULT_CLOUD_URL = "https://app.acolyte.sh";

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Acolyte</title></head>
<body style="margin:0;background:#0a0a0a"><script>window.location.replace("${DEFAULT_CLOUD_URL}")</script></body></html>`;

const ERROR_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Acolyte</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0a0a0a;color:#fafafa}
.card{text-align:center}h1{font-size:2.25rem;font-weight:600;margin:0 0 12px}p{color:#737373;margin:8px 0;line-height:1.5}code{font-family:ui-monospace,monospace;font-size:13px;background:#171717;padding:2px 6px;border-radius:4px;color:#d4d4d4}</style></head>
<body><div class="card"><h1>Something went wrong</h1><p>The login session expired or was invalid.</p><p>Run <code>acolyte login</code> to try again.</p></div></body></html>`;

export type CallbackHandoff = { port: number; result: Promise<CallbackResult>; stop: () => void };

export function startCallbackServer(expectedState: string): Promise<CallbackHandoff> {
  return new Promise((resolveStart) => {
    let resolveResult: (value: CallbackResult) => void;
    let rejectResult: (reason: Error) => void;

    const result = new Promise<CallbackResult>((res, rej) => {
      resolveResult = res;
      rejectResult = rej;
    });

    const timeout = setTimeout(() => {
      rejectResult(new CodedError(LOGIN_ERROR_CODES.callbackTimeout, "the browser did not come back in time"));
      server.stop();
    }, TIMEOUT_MS);

    // Nothing else releases the process: the listener and the timer above both hold the event loop
    // open, so a caller that gives up before the browser answers has to be able to close them. The
    // result is left unsettled on purpose — whoever stops the server already holds its own failure.
    const stop = () => {
      clearTimeout(timeout);
      server.stop();
    };

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/callback") {
          return new Response("Not found", { status: 404 });
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        if (!state || state !== expectedState) {
          return new Response(ERROR_HTML, { status: 400, headers: { "Content-Type": "text/html" } });
        }

        // A cloud that predates the code handoff redirects a token instead, and no code will ever
        // arrive: say so now rather than leaving the CLI waiting out its timeout.
        if (!code) {
          clearTimeout(timeout);
          rejectResult(new CodedError(LOGIN_ERROR_CODES.codeMissing, "the cloud returned no authorization code"));
          setTimeout(() => server.stop(), 100);
          return new Response(ERROR_HTML, { status: 400, headers: { "Content-Type": "text/html" } });
        }

        clearTimeout(timeout);
        resolveResult({ code });

        // Shut down after response is sent
        setTimeout(() => server.stop(), 100);

        return new Response(SUCCESS_HTML, { headers: { "Content-Type": "text/html" } });
      },
    });

    resolveStart({ port: server.port as number, result, stop });
  });
}
