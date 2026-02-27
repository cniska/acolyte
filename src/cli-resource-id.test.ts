import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startTestServer, tempDir } from "./test-factory";

const { createDir, cleanupDirs } = tempDir();
const repoRoot = process.cwd();

afterEach(cleanupDirs);

describe("cli run resource id", () => {
  test("run forwards isolated resource id to server", async () => {
    const home = createDir("acolyte-resource-test-");
    const project = createDir("acolyte-resource-project-");
    const userDataDir = join(home, ".acolyte");
    const projectDataDir = join(project, ".acolyte");
    await mkdir(userDataDir, { recursive: true });
    await mkdir(projectDataDir, { recursive: true });

    const requests: Array<{ sessionId?: string; resourceId?: string }> = [];
    const encoder = new TextEncoder();
    const server = startTestServer(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/v1/chat/stream" && req.method === "POST") {
        const body = (await req.json()) as { sessionId?: string; resourceId?: string; model?: string };
        requests.push({ sessionId: body.sessionId, resourceId: body.resourceId });
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "done",
                    reply: {
                      model: typeof body.model === "string" ? body.model : "gpt-5-mini",
                      output: "ok",
                    },
                  })}\n\n`,
                ),
              );
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      if (url.pathname === "/v1/chat" && req.method === "POST") {
        const body = (await req.json()) as { sessionId?: string; resourceId?: string; model?: string };
        requests.push({ sessionId: body.sessionId, resourceId: body.resourceId });
        return Response.json({
          model: typeof body.model === "string" ? body.model : "gpt-5-mini",
          output: "ok",
        });
      }
      if (url.pathname === "/v1/status" && req.method === "GET") {
        return Response.json({ ok: true, provider: "mock", service: "test" });
      }
      return new Response("not found", { status: 404 });
    });

    try {
      await writeFile(
        join(projectDataDir, "config.toml"),
        `apiUrl = "http://127.0.0.1:${server.port}"\nmodel = "gpt-5-mini"\n`,
        "utf8",
      );

      const proc = Bun.spawn([process.execPath, "run", join(repoRoot, "src/cli.ts"), "run", "ping"], {
        cwd: project,
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
      server.stop();
    }
  });
});
