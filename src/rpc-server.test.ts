import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitForServer } from "./wait-server";

const repoRoot = process.cwd();
const tmpHomes: string[] = [];
const tmpProjects: string[] = [];
const serverProcs: Bun.Subprocess[] = [];

afterEach(async () => {
  for (const proc of serverProcs.splice(0)) {
    proc.kill();
    await proc.exited.catch(() => {});
  }
  while (tmpHomes.length > 0) {
    const dir = tmpHomes.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
  while (tmpProjects.length > 0) {
    const dir = tmpProjects.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

function randomTestPort(): number {
  return 20000 + Math.floor(Math.random() * 10000);
}

async function startServerForRpcTest(port: number, apiKey: string): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "acolyte-rpc-home-"));
  const project = await mkdtemp(join(tmpdir(), "acolyte-rpc-project-"));
  tmpHomes.push(home);
  tmpProjects.push(project);

  await mkdir(join(home, ".acolyte"), { recursive: true });
  await mkdir(join(project, ".acolyte"), { recursive: true });
  await writeFile(join(project, ".acolyte/config.toml"), `port = ${port}\nmodel = "gpt-5-mini"\n`, "utf8");

  const proc = Bun.spawn([process.execPath, "run", join(repoRoot, "src/server.ts")], {
    cwd: project,
    env: { ...process.env, HOME: home, ACOLYTE_API_KEY: apiKey, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  serverProcs.push(proc);
  await waitForServer(`http://127.0.0.1:${port}/v1/status`, 10_000);
}

type RpcEnvelope = { id: string; type: string; [key: string]: unknown };

describe("rpc server websocket queue", () => {
  test(
    "emits queue/abort envelopes and reindexes queued positions",
    async () => {
      const port = randomTestPort();
      const apiKey = "rpc_test_key";
      await startServerForRpcTest(port, apiKey);

      const messages: RpcEnvelope[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/rpc?apiKey=${apiKey}`);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("websocket open timed out")), 5000);
        ws.addEventListener("open", () => {
          clearTimeout(timeout);
          resolve();
        });
        ws.addEventListener("error", () => {
          clearTimeout(timeout);
          reject(new Error("websocket failed to open"));
        });
      });

      ws.addEventListener("message", (event) => {
        try {
          messages.push(JSON.parse(typeof event.data === "string" ? event.data : String(event.data)) as RpcEnvelope);
        } catch {
          // Ignore malformed messages from test perspective.
        }
      });

      const mkRequest = (requestId: string, message: string) => ({
        id: requestId,
        type: "chat.start",
        payload: { request: { message, history: [], model: "gpt-5-mini", sessionId: `sess_${requestId}` } },
      });

      const chat1 = "rpc_test_chat_1";
      const chat2 = "rpc_test_chat_2";
      const chat3 = "rpc_test_chat_3";

      ws.send(JSON.stringify(mkRequest(chat1, "first")));
      ws.send(JSON.stringify(mkRequest(chat2, "second")));
      ws.send(JSON.stringify(mkRequest(chat3, "third")));
      ws.send(JSON.stringify({ id: "rpc_test_abort_2", type: "chat.abort", payload: { requestId: chat2 } }));

      await new Promise<void>((resolve, reject) => {
        const startedAt = Date.now();
        const interval = setInterval(() => {
          const accepted = new Set(messages.filter((m) => m.type === "chat.accepted").map((m) => m.id));
          const chat2QueuedPos1 = messages.some((m) => m.id === chat2 && m.type === "chat.queued" && m.position === 1);
          const chat3QueuedPos2 = messages.some((m) => m.id === chat3 && m.type === "chat.queued" && m.position === 2);
          const chat3ReindexedToPos1 = messages.some(
            (m) => m.id === chat3 && m.type === "chat.queued" && m.position === 1,
          );
          const abortResult = messages.some(
            (m) =>
              m.id === "rpc_test_abort_2" &&
              m.type === "chat.abort.result" &&
              m.requestId === chat2 &&
              m.aborted === true,
          );

          if (
            accepted.has(chat1) &&
            accepted.has(chat2) &&
            accepted.has(chat3) &&
            chat2QueuedPos1 &&
            chat3QueuedPos2 &&
            chat3ReindexedToPos1 &&
            abortResult
          ) {
            clearInterval(interval);
            resolve();
            return;
          }

          if (Date.now() - startedAt > 8000) {
            clearInterval(interval);
            reject(new Error(`timed out waiting for expected rpc envelopes: ${JSON.stringify(messages)}`));
          }
        }, 20);
      });

      ws.close();
    },
    20_000,
  );
});
