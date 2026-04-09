export type CallbackResult = {
  token: string;
  username: string;
};

const TIMEOUT_MS = 120_000;

const DEFAULT_CLOUD_URL = "https://app.acolyte.sh";

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Acolyte</title></head>
<body><script>window.location.replace("${DEFAULT_CLOUD_URL}/dashboard")</script></body></html>`;

const ERROR_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Acolyte</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0a0a0a;color:#fafafa}
.card{text-align:center}h1{font-size:2.25rem;font-weight:600;margin:0 0 12px}p{color:#737373;margin:8px 0;line-height:1.5}code{font-family:ui-monospace,monospace;font-size:13px;background:#171717;padding:2px 6px;border-radius:4px;color:#d4d4d4}</style></head>
<body><div class="card"><h1>Something went wrong</h1><p>The login session expired or was invalid.</p><p>Run <code>acolyte login</code> to try again.</p></div></body></html>`;

export function startCallbackServer(expectedState: string): Promise<{ port: number; result: Promise<CallbackResult> }> {
  return new Promise((resolveStart) => {
    let resolveResult: (value: CallbackResult) => void;
    let rejectResult: (reason: Error) => void;

    const result = new Promise<CallbackResult>((res, rej) => {
      resolveResult = res;
      rejectResult = rej;
    });

    const timeout = setTimeout(() => {
      rejectResult(new Error("timeout"));
      server.stop();
    }, TIMEOUT_MS);

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/callback") {
          return new Response("Not found", { status: 404 });
        }

        const token = url.searchParams.get("token");
        const state = url.searchParams.get("state");
        const username = url.searchParams.get("username");

        if (!token || !state || state !== expectedState) {
          return new Response(ERROR_HTML, { status: 400, headers: { "Content-Type": "text/html" } });
        }

        clearTimeout(timeout);
        resolveResult({ token, username: username ?? "unknown" });

        // Shut down after response is sent
        setTimeout(() => server.stop(), 100);

        return new Response(SUCCESS_HTML, { headers: { "Content-Type": "text/html" } });
      },
    });

    resolveStart({ port: server.port as number, result });
  });
}
