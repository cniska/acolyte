import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dedent } from "./test-factory";
import { runCliPlain, withCliTestEnv, withTestHttpServer } from "./test-tui";

describe("cli visual regression", () => {
  test("version command prints current package version", async () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    const out = await runCliPlain(["--version"]);
    expect(out).toBe(packageJson.version);
  });

  test("top-level help output stays stable", async () => {
    const out = await runCliPlain(["--help"]);
    expect(out).toBe(dedent(`
      Acolyte v0.1.0
      
      Usage
        acolyte
        acolyte <COMMAND> [ARGS]
      
      Commands
        resume [id-prefix]  resume previous session
        run <prompt>        run a single prompt
        history             show recent sessions
        server              manage local API server
        status              show server status
        memory              manage memory notes
        config              manage local CLI config
      
      Options
        -h, --help          print help
        -V, --version       print version
    `));
  });

  test("history command renders aligned session rows", async () => {
    await withCliTestEnv(async ({ run, writeSessionsStore }) => {
      await writeSessionsStore({
        activeSessionId: "sess_a",
        sessions: [
          {
            id: "sess_a",
            createdAt: "2026-03-02T00:00:00.000Z",
            updatedAt: "invalid-time",
            title: "Current",
            model: "gpt-5-mini",
            messages: [],
            tokenUsage: [],
          },
          {
            id: "sess_b",
            createdAt: "2026-03-02T00:00:00.000Z",
            updatedAt: "invalid-time",
            title: "Previous",
            model: "gpt-5-mini",
            messages: [],
            tokenUsage: [],
          },
        ],
      });

      const out = await run(["history"]);
      expect(out).toBe(dedent(`
        sess_a  Current   invalid-time
        sess_b  Previous  invalid-time
      `));
    });
  });

  test("history truncates long titles", async () => {
    await withCliTestEnv(async ({ run, writeSessionsStore }) => {
      await writeSessionsStore({
        activeSessionId: "sess_long",
        sessions: [
          {
            id: "sess_long",
            createdAt: "2026-03-02T00:00:00.000Z",
            updatedAt: "invalid-time",
            title:
              "This title is intentionally made very long so we can verify truncation in history output rows",
            model: "gpt-5-mini",
            messages: [],
            tokenUsage: [],
          },
        ],
      });
      const out = await run(["history"]);
      expect(out).toBe(dedent(`
        sess_long  This title is intentionally made very long so we can verify…  invalid-time
      `));
    });
  });

  test("memory list shows empty-state output", async () => {
    await withCliTestEnv(async ({ run }) => {
      const out = await run(["memory", "list"]);
      expect(out).toBe(dedent(`
        No memories saved.
      `));
    });
  });

  test("memory list renders stored entry rows", async () => {
    await withCliTestEnv(async ({ run, homeDir }) => {
      const memoryDir = join(homeDir, ".acolyte", "memory", "user");
      await mkdir(memoryDir, { recursive: true });
      await writeFile(
        join(memoryDir, "mem_abc123.md"),
        dedent(`
          ---
          id: mem_abc123
          createdAt: invalid-time
          scope: user
          ---
          Prefer concise output.
        `),
        "utf8",
      );
      const out = await run(["memory", "list"]);
      expect(out).toBe(dedent(`
        mem_abc123  Prefer concise output.  invalid-time
      `));
    });
  });

  test("status shows local-server hint when loopback endpoint is unavailable", async () => {
    await withCliTestEnv(async ({ run }) => {
      await run(["config", "set", "apiUrl", "http://127.0.0.1:9"]);
      const out = await run(["status"]);
      expect(out).toBe(dedent(`
        Local server is not running. Start it with: acolyte server start
      `));
    });
  });

  test("config set/list renders aligned persisted values", async () => {
    await withCliTestEnv(async ({ run }) => {
      const saved = await run(["config", "set", "model", "gpt-5-mini"]);
      expect(saved).toBe(dedent(`
        Saved config model (user).
      `));

      const listed = await run(["config", "list"]);
      expect(listed).toBe(dedent(`
        model:           gpt-5-mini
      `));

      const savedProject = await run(["config", "set", "--project", "transportMode", "rpc"]);
      expect(savedProject).toBe(dedent(`
        Saved config transportMode (project).
      `));

      const listedProject = await run(["config", "list", "--project"]);
      expect(listedProject).toBe(dedent(`
        scope:           project
        transportMode:   rpc
      `));
    });
  });

  test("status shows formatted fields on success", async () => {
    await withTestHttpServer(async (request) => {
      if (new URL(request.url).pathname !== "/v1/status") return new Response("not found", { status: 404 });
      return Response.json({
        provider: "openai",
        model: "gpt-5-mini",
        permissions: "read",
        service: "http://localhost:6767",
      });
    }, async (baseUrl) => {
      await withCliTestEnv(async ({ run }) => {
        await run(["config", "set", "apiUrl", baseUrl]);
        const out = await run(["status"]);
        expect(out).toBe(dedent(`
          provider:           openai
          model:              gpt-5-mini
          permissions:        read
          service:            http://localhost:6767
        `));
      });
    });
  });
});
