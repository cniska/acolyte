import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMarkerScenarioHandler,
  createMessagePayload,
  createToolCallsPayload,
  pickFunctionToolName,
  withFakeProviderServer,
} from "../scripts/fake-provider-server";
import { waitForServer } from "../scripts/wait-server";

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

type RpcTestServerOptions = {
  providerBaseUrl?: string;
};

async function startServerForRpcTest(port: number, apiKey: string, options?: RpcTestServerOptions): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "acolyte-rpc-home-"));
  const project = await mkdtemp(join(tmpdir(), "acolyte-rpc-project-"));
  tmpHomes.push(home);
  tmpProjects.push(project);
  await prepareRpcTestProject(project, port, options?.providerBaseUrl);
  await startRpcTestServerProcess(home, project, apiKey, port, options);
}

async function prepareRpcTestProject(project: string, port: number, providerBaseUrl?: string): Promise<void> {
  await mkdir(join(project, ".acolyte"), { recursive: true });
  const lines = [`port = ${port}`, 'model = "gpt-5-mini"'];
  if (providerBaseUrl) lines.push(`openaiBaseUrl = ${JSON.stringify(providerBaseUrl)}`);
  await writeFile(join(project, ".acolyte/config.toml"), `${lines.join("\n")}\n`, "utf8");
}

async function startRpcTestServerProcess(
  home: string,
  project: string,
  apiKey: string,
  port: number,
  options?: RpcTestServerOptions,
): Promise<Bun.Subprocess> {
  await mkdir(join(home, ".acolyte"), { recursive: true });

  const proc = Bun.spawn([process.execPath, "run", join(repoRoot, "src/server.ts")], {
    cwd: project,
    env: {
      ...process.env,
      HOME: home,
      ACOLYTE_API_KEY: apiKey,
      OPENAI_API_KEY: "sk-test-rpc",
      OPENAI_BASE_URL: options?.providerBaseUrl ?? process.env.OPENAI_BASE_URL,
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  serverProcs.push(proc);
  await waitForServer(`http://127.0.0.1:${port}/v1/status`, 10_000);
  return proc;
}

type RpcEnvelope = { id: string; type: string; [key: string]: unknown };

type RpcSession = {
  ws: WebSocket;
  messages: RpcEnvelope[];
};

function sendRpc(ws: WebSocket, payload: Record<string, unknown>): void {
  ws.send(JSON.stringify(payload));
}

async function openRpcSession(port: number, apiKey: string): Promise<RpcSession> {
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

  return { ws, messages };
}

async function waitForRpcCondition(
  messages: RpcEnvelope[],
  condition: (messages: RpcEnvelope[]) => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (condition(messages)) {
        clearInterval(interval);
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`timed out waiting for ${label}: ${JSON.stringify(messages)}`));
      }
    }, 20);
  });
}

function acceptedTaskIdFor(messages: RpcEnvelope[], requestId: string): string | null {
  const accepted = messages.find(
    (m) => m.id === requestId && m.type === "chat.accepted" && typeof m.taskId === "string",
  );
  return (accepted?.taskId as string | undefined) ?? null;
}

describe("server rpc websocket queue", () => {
  test("rejects unauthorized rpc endpoint access", async () => {
    const port = randomTestPort();
    const apiKey = "rpc_test_key";
    await startServerForRpcTest(port, apiKey);

    const missingKey = await fetch(`http://127.0.0.1:${port}/v1/rpc`);
    expect(missingKey.status).toBe(401);

    const wrongKey = await fetch(`http://127.0.0.1:${port}/v1/rpc?apiKey=wrong_key`);
    expect(wrongKey.status).toBe(401);
  });

  test("task.status and chat.abort are available", async () => {
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

    const chatId = "rpc_readmodetaskctrl";
    ws.send(
      JSON.stringify({
        id: chatId,
        type: "chat.start",
        payload: {
          request: {
            message: "Do a long-running analysis with many steps before answering.",
            history: [],
            model: "gpt-5-mini",
            sessionId: "sess_rpcreadmodetaskctrl",
          },
        },
      }),
    );

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        if (messages.some((m) => m.id === chatId && m.type === "chat.started")) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 8000) {
          clearInterval(interval);
          reject(new Error(`timed out waiting for chat.started: ${JSON.stringify(messages)}`));
        }
      }, 20);
    });

    const runningTaskId = acceptedTaskIdFor(messages, chatId);
    expect(runningTaskId).not.toBeNull();
    ws.send(JSON.stringify({ id: "rpc_readmodestatus", type: "task.status", payload: { taskId: runningTaskId } }));

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const statusResult = messages.find((m) => m.id === "rpc_readmodestatus" && m.type === "task.status.result");
        if (statusResult) {
          clearInterval(interval);
          expect(statusResult.task && typeof statusResult.task === "object").toBe(true);
          const task = statusResult.task as { id: unknown; state: unknown };
          expect(task.id).toBe(runningTaskId);
          expect(task.state).toBe("running");
          resolve();
          return;
        }
        if (Date.now() - startedAt > 8000) {
          clearInterval(interval);
          reject(new Error(`timed out waiting for task.status.result: ${JSON.stringify(messages)}`));
        }
      }, 20);
    });

    ws.send(JSON.stringify({ id: "rpc_readmodeabort", type: "chat.abort", payload: { requestId: chatId } }));

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const abortResult = messages.find(
          (m) =>
            m.id === "rpc_readmodeabort" &&
            m.type === "chat.abort.result" &&
            m.requestId === chatId &&
            m.aborted === true,
        );
        if (abortResult) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 8000) {
          clearInterval(interval);
          reject(new Error(`timed out waiting for chat.abort.result: ${JSON.stringify(messages)}`));
        }
      }, 20);
    });

    ws.close();
  }, 20_000);

  test("status reports rpc queue depth and task counters", async () => {
    const port = randomTestPort();
    const apiKey = "rpc_test_key";
    await startServerForRpcTest(port, apiKey);

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

    const messages: RpcEnvelope[] = [];
    ws.addEventListener("message", (event) => {
      try {
        messages.push(JSON.parse(typeof event.data === "string" ? event.data : String(event.data)) as RpcEnvelope);
      } catch {
        // Ignore malformed messages from test perspective.
      }
    });

    ws.send(
      JSON.stringify({
        id: "rpc_statusqueuea",
        type: "chat.start",
        payload: {
          request: {
            message: "Do a long-running analysis with many steps before answering.",
            history: [],
            model: "gpt-5-mini",
            sessionId: "sess_rpcstatusqueuea",
          },
        },
      }),
    );
    ws.send(
      JSON.stringify({
        id: "rpc_statusqueueb",
        type: "chat.start",
        payload: {
          request: {
            message: "Do a long-running analysis with many steps before answering.",
            history: [],
            model: "gpt-5-mini",
            sessionId: "sess_rpcstatusqueueb",
          },
        },
      }),
    );

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const queued = messages.some(
          (m) => m.id === "rpc_statusqueueb" && m.type === "chat.queued" && m.position === 1,
        );
        if (queued) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 8000) {
          clearInterval(interval);
          reject(new Error(`timed out waiting for queued envelope: ${JSON.stringify(messages)}`));
        }
      }, 20);
    });

    const response = await fetch(`http://127.0.0.1:${port}/v1/status`);
    expect(response.status).toBe(200);
    const status = (await response.json()) as Record<string, unknown>;
    expect(status.rpc_queue_length).toBe(1);
    expect(status.tasks_total).toBe(2);
    expect(status.tasks_running).toBe(1);
    expect(typeof status.tasks_detached).toBe("number");

    ws.send(
      JSON.stringify({
        id: "rpc_statusaborta",
        type: "chat.abort",
        payload: { requestId: "rpc_statusqueuea" },
      }),
    );
    ws.send(
      JSON.stringify({
        id: "rpc_statusabortb",
        type: "chat.abort",
        payload: { requestId: "rpc_statusqueueb" },
      }),
    );
    ws.close();
  }, 20_000);

  test("task.status returns null after server restart", async () => {
    const port = randomTestPort();
    const apiKey = "rpc_test_key";
    const home = await mkdtemp(join(tmpdir(), "acolyte-rpc-home-"));
    const project = await mkdtemp(join(tmpdir(), "acolyte-rpc-project-"));
    tmpHomes.push(home);
    tmpProjects.push(project);
    await prepareRpcTestProject(project, port);

    const proc = await startRpcTestServerProcess(home, project, apiKey, port);
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

    const messages: RpcEnvelope[] = [];
    ws.addEventListener("message", (event) => {
      try {
        messages.push(JSON.parse(typeof event.data === "string" ? event.data : String(event.data)) as RpcEnvelope);
      } catch {
        // Ignore malformed messages from test perspective.
      }
    });

    const requestId = "rpc_restarttaskstatus";
    ws.send(
      JSON.stringify({
        id: requestId,
        type: "chat.start",
        payload: {
          request: {
            message: "Do a long-running analysis with many steps before answering.",
            history: [],
            model: "gpt-5-mini",
            sessionId: "sess_rpcrestarttaskstatus",
          },
        },
      }),
    );
    await waitForRpcCondition(
      messages,
      (all) => Boolean(acceptedTaskIdFor(all, requestId)),
      8000,
      "pre-restart accepted task id",
    );
    const taskId = acceptedTaskIdFor(messages, requestId);
    expect(taskId).not.toBeNull();
    ws.send(JSON.stringify({ id: "rpc_restartstatusbefore", type: "task.status", payload: { taskId } }));

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const statusResult = messages.find(
          (m) => m.id === "rpc_restartstatusbefore" && m.type === "task.status.result",
        );
        if (statusResult) {
          clearInterval(interval);
          expect(statusResult.task).not.toBeNull();
          resolve();
          return;
        }
        if (Date.now() - startedAt > 8000) {
          clearInterval(interval);
          reject(new Error(`timed out waiting for pre-restart task status: ${JSON.stringify(messages)}`));
        }
      }, 20);
    });

    ws.close();
    proc.kill();
    await proc.exited.catch(() => {});

    await startRpcTestServerProcess(home, project, apiKey, port);
    const wsAfter = new WebSocket(`ws://127.0.0.1:${port}/v1/rpc?apiKey=${apiKey}`);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("websocket open timed out")), 5000);
      wsAfter.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      wsAfter.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("websocket failed to open"));
      });
    });

    const messagesAfter: RpcEnvelope[] = [];
    wsAfter.addEventListener("message", (event) => {
      try {
        messagesAfter.push(JSON.parse(typeof event.data === "string" ? event.data : String(event.data)) as RpcEnvelope);
      } catch {
        // Ignore malformed messages from test perspective.
      }
    });

    wsAfter.send(JSON.stringify({ id: "rpc_restartstatusafter", type: "task.status", payload: { taskId } }));

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const statusResult = messagesAfter.find(
          (m) => m.id === "rpc_restartstatusafter" && m.type === "task.status.result",
        );
        if (statusResult) {
          clearInterval(interval);
          expect(statusResult.task).toBeNull();
          resolve();
          return;
        }
        if (Date.now() - startedAt > 8000) {
          clearInterval(interval);
          reject(new Error(`timed out waiting for post-restart task status: ${JSON.stringify(messagesAfter)}`));
        }
      }, 20);
    });

    wsAfter.close();
  }, 30_000);

  test("rejects chat.start when rpc queue is full", async () => {
    const port = randomTestPort();
    const apiKey = "rpc_test_key";
    await startServerForRpcTest(port, apiKey);

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

    const messages: RpcEnvelope[] = [];
    ws.addEventListener("message", (event) => {
      try {
        messages.push(JSON.parse(typeof event.data === "string" ? event.data : String(event.data)) as RpcEnvelope);
      } catch {
        // Ignore malformed messages from test perspective.
      }
    });

    const requestFor = (id: string) =>
      JSON.stringify({
        id,
        type: "chat.start",
        payload: {
          request: {
            message: "Do a long-running analysis with many steps before answering.",
            history: [],
            model: "gpt-5-mini",
            sessionId: `sess_${id.replace("rpc_", "")}`,
          },
        },
      });

    // 1 running + 25 queued hits the queue limit.
    ws.send(requestFor("rpc_queuelimitrunning"));
    for (let i = 0; i < 25; i += 1) ws.send(requestFor(`rpc_queuelimitq${i}`));
    ws.send(requestFor("rpc_queuelimitoverflow"));

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const overflowError = messages.find(
          (m) =>
            m.id === "rpc_queuelimitoverflow" &&
            m.type === "error" &&
            typeof m.error === "string" &&
            m.error.includes("RPC queue is full") &&
            m.error.includes("Try again shortly."),
        );
        if (overflowError) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 8000) {
          clearInterval(interval);
          reject(new Error(`timed out waiting for queue overflow error: ${JSON.stringify(messages)}`));
        }
      }, 20);
    });

    expect(messages.some((m) => m.id === "rpc_queuelimitoverflow" && m.type === "chat.accepted")).toBe(false);

    ws.close();
  }, 20_000);

  test("emits queue/abort envelopes and reindexes queued positions", async () => {
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
      payload: {
        request: { message, history: [], model: "gpt-5-mini", sessionId: `sess_${requestId.replace("rpc_", "")}` },
      },
    });

    const chat1 = "rpc_testchat1";
    const chat2 = "rpc_testchat2";
    const chat3 = "rpc_testchat3";

    ws.send(JSON.stringify(mkRequest(chat1, "first")));
    ws.send(JSON.stringify(mkRequest(chat2, "second")));
    ws.send(JSON.stringify(mkRequest(chat3, "third")));
    ws.send(JSON.stringify({ id: "rpc_testabort2", type: "chat.abort", payload: { requestId: chat2 } }));

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
            m.id === "rpc_testabort2" && m.type === "chat.abort.result" && m.requestId === chat2 && m.aborted === true,
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
  }, 20_000);

  test("abort interrupts active chat and suppresses further stream envelopes", async () => {
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

    const chatId = "rpc_abortactivechat";
    ws.send(
      JSON.stringify({
        id: chatId,
        type: "chat.start",
        payload: {
          request: {
            message: "Do a long-running analysis with many steps before answering.",
            history: [],
            model: "gpt-5-mini",
            sessionId: "sess_rpcabortactive",
          },
        },
      }),
    );

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        if (messages.some((m) => m.id === chatId && m.type === "chat.started")) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 8000) {
          clearInterval(interval);
          reject(new Error(`timed out waiting for chat.started: ${JSON.stringify(messages)}`));
        }
      }, 20);
    });

    ws.send(JSON.stringify({ id: "rpc_abortactivereq", type: "chat.abort", payload: { requestId: chatId } }));

    const abortIndex = await new Promise<number>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const index = messages.findIndex(
          (m) =>
            m.id === "rpc_abortactivereq" &&
            m.type === "chat.abort.result" &&
            m.requestId === chatId &&
            m.aborted === true,
        );
        if (index !== -1) {
          clearInterval(interval);
          resolve(index);
          return;
        }
        if (Date.now() - startedAt > 8000) {
          clearInterval(interval);
          reject(new Error(`timed out waiting for chat.abort.result: ${JSON.stringify(messages)}`));
        }
      }, 20);
    });

    await Bun.sleep(250);
    const afterAbort = messages.slice(abortIndex + 1).filter((m) => m.id === chatId);
    const illegal = afterAbort.filter(
      (m) => m.type === "chat.event" || m.type === "chat.done" || m.type === "chat.error",
    );
    expect(illegal).toEqual([]);

    ws.close();
  }, 20_000);

  test("returns task status for missing and active rpc chat tasks", async () => {
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

    ws.send(JSON.stringify({ id: "rpc_taskstatusmissing", type: "task.status", payload: { taskId: "task_missing0" } }));

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const missingResult = messages.find((m) => m.id === "rpc_taskstatusmissing" && m.type === "task.status.result");
        if (missingResult) {
          clearInterval(interval);
          expect(missingResult.task).toBeNull();
          resolve();
          return;
        }
        if (Date.now() - startedAt > 8000) {
          clearInterval(interval);
          reject(new Error(`timed out waiting for missing task status: ${JSON.stringify(messages)}`));
        }
      }, 20);
    });

    const chatId = "rpc_taskstatuschat";
    ws.send(
      JSON.stringify({
        id: chatId,
        type: "chat.start",
        payload: {
          request: {
            message: "Do a long-running analysis with many steps before answering.",
            history: [],
            model: "gpt-5-mini",
            sessionId: "sess_rpctaskstatus",
          },
        },
      }),
    );

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        if (messages.some((m) => m.id === chatId && m.type === "chat.accepted")) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 8000) {
          clearInterval(interval);
          reject(new Error(`timed out waiting for chat.accepted: ${JSON.stringify(messages)}`));
        }
      }, 20);
    });

    const activeTaskId = acceptedTaskIdFor(messages, chatId);
    expect(activeTaskId).not.toBeNull();
    ws.send(JSON.stringify({ id: "rpc_taskstatusactive", type: "task.status", payload: { taskId: activeTaskId } }));

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const activeResult = messages.find((m) => m.id === "rpc_taskstatusactive" && m.type === "task.status.result");
        if (activeResult) {
          clearInterval(interval);
          expect(activeResult.task && typeof activeResult.task === "object").toBe(true);
          const task = activeResult.task as { id: unknown; state: unknown };
          expect(task.id).toBe(activeTaskId);
          expect(task.state).toBe("running");
          resolve();
          return;
        }
        if (Date.now() - startedAt > 8000) {
          clearInterval(interval);
          reject(new Error(`timed out waiting for active task status: ${JSON.stringify(messages)}`));
        }
      }, 20);
    });

    ws.send(JSON.stringify({ id: "rpc_taskstatusabort", type: "chat.abort", payload: { requestId: chatId } }));
    ws.close();
  }, 20_000);

  test("keeps queued task states isolated when aborting the active task", async () => {
    const port = randomTestPort();
    const apiKey = "rpc_test_key";
    await startServerForRpcTest(port, apiKey);

    const { ws, messages } = await openRpcSession(port, apiKey);

    const activeRequestId = "rpc_isolationactive";
    const queuedRequestId = "rpc_isolationqueued";
    const activeSession = "sess_rpcisolationactive";
    const queuedSession = "sess_rpcisolationqueued";

    sendRpc(ws, {
      id: activeRequestId,
      type: "chat.start",
      payload: {
        request: {
          message: "Do a long-running analysis with many steps before answering.",
          history: [],
          model: "gpt-5-mini",
          sessionId: activeSession,
        },
      },
    });
    sendRpc(ws, {
      id: queuedRequestId,
      type: "chat.start",
      payload: {
        request: {
          message: "Do a long-running analysis with many steps before answering.",
          history: [],
          model: "gpt-5-mini",
          sessionId: queuedSession,
        },
      },
    });

    await waitForRpcCondition(
      messages,
      (all) =>
        all.some((m) => m.id === activeRequestId && m.type === "chat.started") &&
        all.some((m) => m.id === queuedRequestId && m.type === "chat.queued" && m.position === 1),
      8000,
      "running+queued envelopes",
    );

    const activeTaskId = acceptedTaskIdFor(messages, activeRequestId);
    const queuedTaskId = acceptedTaskIdFor(messages, queuedRequestId);
    expect(activeTaskId).not.toBeNull();
    expect(queuedTaskId).not.toBeNull();

    sendRpc(ws, { id: "rpc_isolationstatusactivepre", type: "task.status", payload: { taskId: activeTaskId } });
    sendRpc(ws, { id: "rpc_isolationstatusqueuedpre", type: "task.status", payload: { taskId: queuedTaskId } });

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const active = messages.find((m) => m.id === "rpc_isolationstatusactivepre" && m.type === "task.status.result");
        const queued = messages.find((m) => m.id === "rpc_isolationstatusqueuedpre" && m.type === "task.status.result");
        if (active && queued) {
          clearInterval(interval);
          const activeTask = active.task as { id: unknown; state: unknown };
          const queuedTask = queued.task as { id: unknown; state: unknown };
          expect(activeTask.id).toBe(activeTaskId);
          expect(activeTask.state).toBe("running");
          expect(queuedTask.id).toBe(queuedTaskId);
          expect(queuedTask.state).toBe("queued");
          resolve();
          return;
        }
        if (Date.now() - startedAt > 8000) {
          clearInterval(interval);
          reject(new Error(`timed out waiting for pre-abort task statuses: ${JSON.stringify(messages)}`));
        }
      }, 20);
    });

    sendRpc(ws, { id: "rpc_isolationabortactive", type: "chat.abort", payload: { requestId: activeRequestId } });

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const abortResult = messages.find(
          (m) =>
            m.id === "rpc_isolationabortactive" &&
            m.type === "chat.abort.result" &&
            m.requestId === activeRequestId &&
            m.aborted === true,
        );
        if (abortResult) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 8000) {
          clearInterval(interval);
          reject(new Error(`timed out waiting for active abort result: ${JSON.stringify(messages)}`));
        }
      }, 20);
    });

    sendRpc(ws, { id: "rpc_isolationstatusactivepost", type: "task.status", payload: { taskId: activeTaskId } });
    sendRpc(ws, { id: "rpc_isolationstatusqueuedpost", type: "task.status", payload: { taskId: queuedTaskId } });

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const active = messages.find(
          (m) => m.id === "rpc_isolationstatusactivepost" && m.type === "task.status.result",
        );
        const queued = messages.find(
          (m) => m.id === "rpc_isolationstatusqueuedpost" && m.type === "task.status.result",
        );
        if (active && queued) {
          clearInterval(interval);
          const activeTask = active.task as { id: unknown; state: unknown };
          const queuedTask = queued.task as { id: unknown; state: unknown };
          expect(activeTask.id).toBe(activeTaskId);
          expect(activeTask.state).toBe("cancelled");
          expect(queuedTask.id).toBe(queuedTaskId);
          expect(queuedTask.state).toBe("queued");
          resolve();
          return;
        }
        if (Date.now() - startedAt > 8000) {
          clearInterval(interval);
          reject(new Error(`timed out waiting for post-abort task statuses: ${JSON.stringify(messages)}`));
        }
      }, 20);
    });

    sendRpc(ws, { id: "rpc_isolationabortqueued", type: "chat.abort", payload: { requestId: queuedRequestId } });
    ws.close();
  }, 20_000);

  test("does not leak tool-call path args across task ids", async () => {
    const port = randomTestPort();
    const apiKey = "rpc_test_key";
    const taskA = "rpc_taskpathisoa";
    const taskB = "rpc_taskpathisob";
    const fileA = "tmp_path_iso_a.txt";
    const fileB = "tmp_path_iso_b.txt";

    const fakeHandler = createMarkerScenarioHandler(
      [
        {
          id: "task_a",
          marker: fileA,
          handle: ({ model, responseCounter, outputs, body }) => {
            if (outputs.length === 0) {
              const toolName = pickFunctionToolName(body.tools, "create-file", ["create", "file"]);
              return createToolCallsPayload(model, responseCounter, [
                {
                  id: "fc_path_iso_a",
                  callId: "call_path_iso_a",
                  name: toolName,
                  args: JSON.stringify({ path: fileA, content: "alpha path isolation" }),
                },
              ]);
            }
            return createMessagePayload(model, responseCounter, "done");
          },
        },
        {
          id: "task_b",
          marker: fileB,
          handle: ({ model, responseCounter, outputs, body }) => {
            if (outputs.length === 0) {
              const toolName = pickFunctionToolName(body.tools, "create-file", ["create", "file"]);
              return createToolCallsPayload(model, responseCounter, [
                {
                  id: "fc_path_iso_b",
                  callId: "call_path_iso_b",
                  name: toolName,
                  args: JSON.stringify({ path: fileB, content: "beta path isolation" }),
                },
              ]);
            }
            return createMessagePayload(model, responseCounter, "done");
          },
        },
      ] as const,
      "ok",
    );

    await withFakeProviderServer(
      async (providerBaseUrl) => {
        await startServerForRpcTest(port, apiKey, { providerBaseUrl });

        const { ws, messages } = await openRpcSession(port, apiKey);
        sendRpc(ws, {
          id: taskA,
          type: "chat.start",
          payload: {
            request: {
              message: `Create ${fileA} with exactly: alpha path isolation`,
              history: [],
              model: "gpt-5-mini",
              sessionId: "sess_rpcpathisoa",
            },
          },
        });
        sendRpc(ws, {
          id: taskB,
          type: "chat.start",
          payload: {
            request: {
              message: `Create ${fileB} with exactly: beta path isolation`,
              history: [],
              model: "gpt-5-mini",
              sessionId: "sess_rpcpathisob",
            },
          },
        });

        await new Promise<void>((resolve, reject) => {
          const startedAt = Date.now();
          const interval = setInterval(() => {
            const terminalA = messages.some(
              (m) => m.id === taskA && (m.type === "chat.done" || m.type === "chat.error"),
            );
            const terminalB = messages.some(
              (m) => m.id === taskB && (m.type === "chat.done" || m.type === "chat.error"),
            );
            if (terminalA && terminalB) {
              clearInterval(interval);
              resolve();
              return;
            }
            if (Date.now() - startedAt > 12_000) {
              clearInterval(interval);
              reject(new Error(`timed out waiting for both terminal chat envelopes: ${JSON.stringify(messages)}`));
            }
          }, 20);
        });

        const toolCallsFor = (taskId: string): RpcEnvelope[] =>
          messages.filter(
            (m) =>
              m.id === taskId &&
              m.type === "chat.event" &&
              typeof m.event === "object" &&
              m.event !== null &&
              (m.event as { type?: unknown }).type === "tool-call",
          );

        const argsBlob = (events: RpcEnvelope[]): string =>
          events
            .map((m) => {
              const event = m.event as { args?: unknown };
              return JSON.stringify(event.args ?? {});
            })
            .join("\n")
            .toLowerCase();

        const taskAEvents = toolCallsFor(taskA);
        const taskBEvents = toolCallsFor(taskB);
        const taskAArgs = argsBlob(taskAEvents);
        const taskBArgs = argsBlob(taskBEvents);

        // Enforce only the isolation invariant across concurrent task ids.
        expect(taskAArgs).not.toContain(fileB);
        expect(taskBArgs).not.toContain(fileA);

        ws.close();
      },
      { handleRequest: fakeHandler },
    );
  }, 20_000);
});
