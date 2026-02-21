import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpHomes: string[] = [];

afterEach(async () => {
  while (tmpHomes.length > 0) {
    const dir = tmpHomes.pop();
    if (!dir) {
      continue;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

describe("cli run resource id", () => {
  test("run forwards isolated resource id to backend", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-resource-test-"));
    tmpHomes.push(home);
    const dataDir = join(home, ".acolyte");
    await mkdir(dataDir, { recursive: true });

    const requests: Array<{ sessionId?: string; resourceId?: string }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/v1/chat" && req.method === "POST") {
          const body = (await req.json()) as { sessionId?: string; resourceId?: string; model?: string };
          requests.push({ sessionId: body.sessionId, resourceId: body.resourceId });
          return Response.json({
            model: typeof body.model === "string" ? body.model : "gpt-5-mini",
            output: "ok",
          });
        }
        if (url.pathname === "/healthz" && req.method === "GET") {
          return Response.json({ ok: true, provider: "mock", service: "test" });
        }
        return new Response("not found", { status: 404 });
      },
    });

    try {
      await writeFile(
        join(dataDir, "config.json"),
        JSON.stringify(
          {
            apiUrl: `http://127.0.0.1:${server.port}`,
            model: "gpt-5-mini",
          },
          null,
          2,
        ),
        "utf8",
      );

      const proc = Bun.spawn([process.execPath, "run", "src/cli.ts", "run", "ping"], {
        cwd: process.cwd(),
        env: { ...process.env, HOME: home, NO_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("❯ ping");
      expect(requests.length).toBe(1);

      const request = requests[0];
      expect(request.sessionId?.startsWith("sess_")).toBe(true);
      expect(request.resourceId?.startsWith("run-")).toBe(true);
      const expectedResource = `run-${(request.sessionId ?? "").replace(/^sess_/, "").slice(0, 24)}`;
      expect(request.resourceId).toBe(expectedResource);
    } finally {
      server.stop(true);
    }
  });
});
