import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpHomes: string[] = [];
const tmpProjects: string[] = [];
const repoRoot = process.cwd();

afterEach(async () => {
  while (tmpHomes.length > 0) {
    const dir = tmpHomes.pop();
    if (!dir) {
      continue;
    }
    await rm(dir, { recursive: true, force: true });
  }
  while (tmpProjects.length > 0) {
    const dir = tmpProjects.pop();
    if (!dir) {
      continue;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

describe("cli run resource id", () => {
  test("run forwards isolated resource id to backend", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-resource-test-"));
    const project = await mkdtemp(join(tmpdir(), "acolyte-resource-project-"));
    tmpHomes.push(home);
    tmpProjects.push(project);
    const userDataDir = join(home, ".acolyte");
    const projectDataDir = join(project, ".acolyte");
    await mkdir(userDataDir, { recursive: true });
    await mkdir(projectDataDir, { recursive: true });

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
      server.stop(true);
    }
  });
});
