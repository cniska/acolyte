import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCliPlain, withCliTestEnv } from "./int-test-utils";
import { PROTOCOL_VERSION } from "./protocol";
import { dedent } from "./test-utils";
import { createTraceStore } from "./trace-store";

async function withDualTransportChatServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const reply = {
    model: "gpt-5-mini",
    output: "Transport parity ok.",
  };
  const server = Bun.serve({
    port: 0,
    fetch(request, srv) {
      const url = new URL(request.url);
      if (url.pathname === "/v1/status") {
        return Response.json({ ok: true, protocol_version: PROTOCOL_VERSION });
      }
      if (url.pathname === "/v1/chat/stream") {
        const body = `data: ${JSON.stringify({ type: "done", reply })}\n\n`;
        return new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      if (url.pathname === "/v1/rpc") {
        if (srv.upgrade(request)) return;
        return new Response("upgrade required", { status: 426 });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      message(ws, message) {
        let payload: unknown;
        try {
          payload = JSON.parse(typeof message === "string" ? message : Buffer.from(message).toString("utf8"));
        } catch {
          return;
        }
        if (!payload || typeof payload !== "object") return;
        const envelope = payload as { id?: unknown; type?: unknown };
        if (typeof envelope.id !== "string" || typeof envelope.type !== "string") return;

        if (envelope.type === "status.get") {
          ws.send(
            JSON.stringify({
              id: envelope.id,
              type: "status.result",
              status: {
                ok: true,
                providers: ["openai"],
                model: "gpt-5-mini",
                protocol_version: PROTOCOL_VERSION,
                capabilities: "stream.sse, error.structured",
                permissions: "write",
                service: "http://localhost:6767",
                memory: "file",
                tasks_total: 0,
                tasks_running: 0,
                tasks_detached: 0,
                rpc_queue_length: 0,
              },
            }),
          );
          return;
        }
        if (envelope.type === "chat.start") {
          ws.send(JSON.stringify({ id: envelope.id, type: "chat.accepted", taskId: "task_cli_visual" }));
          ws.send(JSON.stringify({ id: envelope.id, type: "chat.started" }));
          ws.send(JSON.stringify({ id: envelope.id, type: "chat.done", reply }));
        }
      },
    },
  });
  try {
    return await fn(`http://0.0.0.0:${server.port}`);
  } finally {
    server.stop(true);
  }
}

function normalizeRunOutput(value: string): string {
  return value.replace(/Worked [0-9.]+s/g, "Worked <duration>");
}

describe("cli visual regression", () => {
  test("version command prints current package version", async () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    const out = await runCliPlain(["--version"]);
    expect(out).toMatch(new RegExp(`^${packageJson.version}( \\([0-9a-f]{7}\\))?$`));
  });

  test("top-level help output stays stable", async () => {
    const out = await runCliPlain(["--help"]);
    expect(out).toBe(
      dedent(`
      Acolyte v0.10.0

      Usage
        acolyte
        acolyte <COMMAND> [ARGS]

      Commands
        init [provider]        initialize provider API key
        resume [id]            resume previous session
        run <prompt>           run a single prompt
        history                show recent sessions
        start                  start server
        stop                   stop all servers
        restart                restart server
        ps                     list running servers
        status                 show server status
        memory                 manage memory
        config                 manage config
        skill <name> [prompt]  run a prompt with an active skill
        logs                   view server logs
        trace                  inspect server lifecycle traces

      Options
        -h, --help             print help
        -V, --version          print version
    `),
    );
  });

  test("history command renders aligned session rows", async () => {
    await withCliTestEnv(async ({ run, writeSessionsStore }) => {
      await writeSessionsStore({
        activeSessionId: "sess_a",
        sessions: [
          {
            id: "sess_a",
            createdAt: "2026-03-02T00:00:00.000Z",
            updatedAt: "9999-01-01T00:00:00.000Z",
            title: "Current",
            model: "gpt-5-mini",
            messages: [],
            tokenUsage: [],
          },
          {
            id: "sess_b",
            createdAt: "2026-03-02T00:00:00.000Z",
            updatedAt: "9999-01-01T00:00:00.000Z",
            title: "Previous",
            model: "gpt-5-mini",
            messages: [],
            tokenUsage: [],
          },
        ],
      });

      const out = await run(["history"]);
      expect(out).toBe(
        dedent(`
        sess_a  Current   just now
        sess_b  Previous  just now
      `),
      );
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
            updatedAt: "9999-01-01T00:00:00.000Z",
            title: "This title is intentionally made very long so we can verify truncation in history output rows",
            model: "gpt-5-mini",
            messages: [],
            tokenUsage: [],
          },
        ],
      });
      const out = await run(["history"]);
      expect(out).toBe(
        dedent(`
        sess_long  This title is intentionally made very long so we can verify…  just now
      `),
      );
    });
  });

  test("memory list shows empty-state output", async () => {
    await withCliTestEnv(async ({ run }) => {
      const out = await run(["memory", "list"]);
      expect(out).toBe(
        dedent(`
        No memories saved.
      `),
      );
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
          createdAt: 9999-01-01T00:00:00.000Z
          scope: user
          ---
          Prefer concise output.
        `),
        "utf8",
      );
      const out = await run(["memory", "list"]);
      expect(out).toBe(
        dedent(`
        mem_abc123  Prefer concise output.  just now
      `),
      );
    });
  });

  test("status shows local-server hint when loopback endpoint is unavailable", async () => {
    await withCliTestEnv(async ({ run }) => {
      await run(["config", "set", "port", "9"]);
      const out = await run(["status"]);
      expect(out).toBe(
        dedent(`
        Server is not running. Start it with: acolyte start
      `),
      );
    });
  });

  test("config set/list renders aligned persisted values", async () => {
    await withCliTestEnv(async ({ run }) => {
      const saved = await run(["config", "set", "model", "gpt-5-mini"]);
      expect(saved).toBe(
        dedent(`
        Saved config model (user).
      `),
      );

      const listed = await run(["config", "list"]);
      expect(listed).toBe(
        dedent(`
        model:  gpt-5-mini
      `),
      );

      const savedProject = await run(["config", "set", "--project", "logFormat", "json"]);
      expect(savedProject).toBe(
        dedent(`
        Saved config logFormat (project).
      `),
      );

      const listedProject = await run(["config", "list", "--project"]);
      expect(listedProject).toBe(
        dedent(`
        scope:      project
        logFormat:  json
      `),
      );
    });
  });

  test("status shows formatted fields on success", async () => {
    await withDualTransportChatServer(async (baseUrl) => {
      await withCliTestEnv(async ({ run }) => {
        const port = new URL(baseUrl).port;
        await run(["config", "set", "port", port]);
        const out = await run(["status"]);
        expect(out).toBe(
          dedent(`
          Providers:          openai
          Model:              gpt-5-mini
          Protocol version:   2
          Capabilities:       stream.sse, error.structured
          Permissions:        write
          Service:            http://localhost:6767
          Memory:             file
          Tasks total:        0
          Tasks running:      0
          Tasks detached:     0
          Queue length:       0
        `),
        );
      });
    });
  });

  test("status outputs raw JSON with --json", async () => {
    await withDualTransportChatServer(async (baseUrl) => {
      await withCliTestEnv(async ({ run }) => {
        const port = new URL(baseUrl).port;
        await run(["config", "set", "port", port]);
        const out = await run(["status", "--json"]);
        const parsed = JSON.parse(out) as { protocol_version: string };
        expect(parsed.protocol_version).toBe("2");
      });
    });
  });
  test("run output is stable over rpc transport", async () => {
    await withDualTransportChatServer(async (baseUrl) => {
      await withCliTestEnv(async ({ run }) => {
        const port = new URL(baseUrl).port;
        await run(["config", "set", "port", port]);
        const output = normalizeRunOutput(await run(["run", "hello transport parity"]));
        expect(output).toContain("Transport parity ok.");
      });
    });
  }, 20_000);

  test.each([
    {
      args: ["init", "help"],
      output: dedent(`
        Usage: acolyte init [openai|anthropic|google]
        
        Description: initialize provider API key
        
        Examples:
          acolyte init
          acolyte init openai
      `),
    },
    {
      args: ["resume", "help"],
      output: dedent(`
        Usage: acolyte resume [id]
        
        Description: resume previous session
        
        Examples:
          acolyte resume
          acolyte resume sess_abc123
      `),
    },
    {
      args: ["run", "help"],
      output: dedent(`
        Usage: acolyte run [--file <path>] [--workspace <path>] [--model <id>] <prompt>

        Description: run a single prompt

        Examples:
          acolyte run "summarize README.md"
          acolyte run --file src/cli.ts "refactor help text"
      `),
    },
    {
      args: ["history", "help"],
      output: dedent(`
        Usage: acolyte history
        
        Description: show recent sessions
        
        Examples:
          acolyte history
      `),
    },
    {
      args: ["start", "help"],
      output: dedent(`
        Usage: acolyte start

        Description: start server

        Examples:
          acolyte start
      `),
    },
    {
      args: ["stop", "help"],
      output: dedent(`
        Usage: acolyte stop

        Description: stop all servers

        Examples:
          acolyte stop
      `),
    },
    {
      args: ["restart", "help"],
      output: dedent(`
        Usage: acolyte restart

        Description: restart server

        Examples:
          acolyte restart
      `),
    },
    {
      args: ["ps", "help"],
      output: dedent(`
        Usage: acolyte ps

        Description: list running servers

        Examples:
          acolyte ps
      `),
    },
    {
      args: ["status", "help"],
      output: dedent(`
        Usage: acolyte status

        Description: show server status

        Examples:
          acolyte status
      `),
    },
    {
      args: ["memory", "help"],
      output: dedent(`
        Usage: acolyte memory <list|add> [options]
        
        Description: manage memory
        
        Examples:
          acolyte memory list
          acolyte memory add --project "prefer bun run verify"
      `),
    },
    {
      args: ["config", "help"],
      output: dedent(`
        Usage: acolyte config <list|set|unset> [options]
        
        Description: manage config
        
        Examples:
          acolyte config list
          acolyte config set model gpt-5-mini
          acolyte config unset port
      `),
    },
    {
      args: ["tool", "help"],
      output: dedent(`
        Usage: acolyte tool <tool-id> [args...]

        Description: run a tool directly

        Examples:
          acolyte tool find-files "src/**/*.ts"
          acolyte tool run-command "bun run verify"
      `),
    },
    {
      args: ["logs", "help"],
      output: dedent(`
        Usage: acolyte logs [-n <count>] [--level <level>] [--session <id>] [--since <duration>] [--json]

        Description: view server logs

        Examples:
          acolyte logs
          acolyte logs -n 100
          acolyte logs --level error --since 1h
      `),
    },
    {
      args: ["trace", "help"],
      output: dedent(`
        Usage: acolyte trace [list|task <id>] [--lines <n>] [--verbose] [--json]

        Description: inspect server lifecycle traces

        Examples:
          acolyte trace
          acolyte trace task task_abc123
          acolyte trace task --verbose
      `),
    },
  ])("renders subcommand help output %#", async ({ args, output }) => {
    const out = await runCliPlain(args);
    expect(out).toBe(output);
  });

  test("trace command filters by task id from store", async () => {
    await withCliTestEnv(async ({ run, homeDir }) => {
      const store = createTraceStore(join(homeDir, ".acolyte", "trace.db"));
      store.write({
        timestamp: "2026-03-19T10:00:00Z",
        taskId: "task_abc",
        event: "lifecycle.start",
        fields: { mode: "work", model: "gpt-5-mini" },
      });
      store.write({
        timestamp: "2026-03-19T10:00:01Z",
        taskId: "task_abc",
        event: "lifecycle.tool.call",
        fields: { tool: "read-file", path: "src/cli.ts" },
      });
      store.write({
        timestamp: "2026-03-19T10:00:02Z",
        taskId: "task_other",
        event: "lifecycle.tool.call",
        fields: { tool: "read-file", path: "README.md" },
      });
      store.write({
        timestamp: "2026-03-19T10:00:03Z",
        taskId: "task_abc",
        event: "lifecycle.summary",
        fields: {
          model_calls: "1",
          tool_calls: "1",
          read_calls: "1",
          search_calls: "0",
          write_calls: "0",
          pre_write_discovery_calls: "0",
          regeneration_count: "0",
          guard_blocked_count: "0",
          guard_flag_set_count: "0",
          has_error: "false",
        },
      });
      store.close();
      const out = await run(["trace", "task", "task_abc"]);
      expect(out).toBe(
        dedent(`
          task_abc  gpt-5-mini  3.0s

          read-file  src/cli.ts

          model_calls=1  tools=1 (read=1)  status=ok
        `),
      );
    });
  });

  test("trace default lists recent tasks", async () => {
    await withCliTestEnv(async ({ run, homeDir }) => {
      const store = createTraceStore(join(homeDir, ".acolyte", "trace.db"));
      store.write({
        timestamp: "9999-01-01T00:00:00Z",
        taskId: "task_latest",
        event: "lifecycle.start",
        fields: { mode: "work", model: "gpt-5-mini" },
      });
      store.write({
        timestamp: "9999-01-01T00:00:01Z",
        taskId: "task_latest",
        event: "lifecycle.generate.done",
        fields: { model: "gpt-5-mini", tool_calls: "2" },
      });
      store.close();
      const out = await run(["trace"]);
      expect(out).toBe(
        dedent(`
          Task         Model       Status  Time
          task_latest  gpt-5-mini  ok      just now
        `),
      );
    });
  });
});
