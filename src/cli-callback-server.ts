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
.card{text-align:center}h1{margin:0 0 8px;color:#ef4444}p{color:#888}</style></head>
<body><div class="card"><h1>Error</h1><p>Invalid or expired callback. Please try again.</p></div></body></html>`;

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
