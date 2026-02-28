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
    env: {
      ...process.env,
      HOME: home,
      ACOLYTE_API_KEY: apiKey,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "sk-test-rpc",
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  serverProcs.push(proc);
  await waitForServer(`http://127.0.0.1:${port}/v1/status`, 10_000);
}

async function setServerPermissionMode(port: number, apiKey: string, mode: "read" | "write"): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/permissions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`failed to set permission mode to ${mode}: ${body}`);
  }
}

type RpcEnvelope = { id: string; type: string; [key: string]: unknown };

describe("rpc server websocket queue", () => {
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

    const chatId = "rpc_abort_active_chat";
    ws.send(
      JSON.stringify({
        id: chatId,
        type: "chat.start",
        payload: {
          request: {
            message: "Do a long-running analysis with many steps before answering.",
            history: [],
            model: "gpt-5-mini",
            sessionId: "sess_rpc_abort_active",
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

    ws.send(JSON.stringify({ id: "rpc_abort_active_req", type: "chat.abort", payload: { requestId: chatId } }));

    const abortIndex = await new Promise<number>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const index = messages.findIndex(
          (m) =>
            m.id === "rpc_abort_active_req" &&
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

    ws.send(
      JSON.stringify({ id: "rpc_task_status_missing", type: "task.status", payload: { taskId: "missing_task" } }),
    );

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const missingResult = messages.find(
          (m) => m.id === "rpc_task_status_missing" && m.type === "task.status.result",
        );
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

    const chatId = "rpc_task_status_chat";
    ws.send(
      JSON.stringify({
        id: chatId,
        type: "chat.start",
        payload: {
          request: {
            message: "Do a long-running analysis with many steps before answering.",
            history: [],
            model: "gpt-5-mini",
            sessionId: "sess_rpc_task_status",
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

    ws.send(JSON.stringify({ id: "rpc_task_status_active", type: "task.status", payload: { taskId: chatId } }));

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const activeResult = messages.find((m) => m.id === "rpc_task_status_active" && m.type === "task.status.result");
        if (activeResult) {
          clearInterval(interval);
          expect(activeResult.task && typeof activeResult.task === "object").toBe(true);
          const task = activeResult.task as { id: unknown; state: unknown };
          expect(task.id).toBe(chatId);
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

    ws.send(JSON.stringify({ id: "rpc_task_status_abort", type: "chat.abort", payload: { requestId: chatId } }));
    ws.close();
  }, 20_000);

  test("keeps queued task states isolated when aborting the active task", async () => {
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

    const activeTaskId = "rpc_isolation_active";
    const queuedTaskId = "rpc_isolation_queued";
    const activeSession = "sess_rpc_isolation_active";
    const queuedSession = "sess_rpc_isolation_queued";

    ws.send(
      JSON.stringify({
        id: activeTaskId,
        type: "chat.start",
        payload: {
          request: {
            message: "Do a long-running analysis with many steps before answering.",
            history: [],
            model: "gpt-5-mini",
            sessionId: activeSession,
          },
        },
      }),
    );
    ws.send(
      JSON.stringify({
        id: queuedTaskId,
        type: "chat.start",
        payload: {
          request: {
            message: "Do a long-running analysis with many steps before answering.",
            history: [],
            model: "gpt-5-mini",
            sessionId: queuedSession,
          },
        },
      }),
    );

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const activeStarted = messages.some((m) => m.id === activeTaskId && m.type === "chat.started");
        const queuedQueued = messages.some(
          (m) => m.id === queuedTaskId && m.type === "chat.queued" && m.position === 1,
        );
        if (activeStarted && queuedQueued) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 8000) {
          clearInterval(interval);
          reject(new Error(`timed out waiting for running+queued envelopes: ${JSON.stringify(messages)}`));
        }
      }, 20);
    });

    ws.send(
      JSON.stringify({ id: "rpc_isolation_status_active_pre", type: "task.status", payload: { taskId: activeTaskId } }),
    );
    ws.send(
      JSON.stringify({ id: "rpc_isolation_status_queued_pre", type: "task.status", payload: { taskId: queuedTaskId } }),
    );

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const active = messages.find(
          (m) => m.id === "rpc_isolation_status_active_pre" && m.type === "task.status.result",
        );
        const queued = messages.find(
          (m) => m.id === "rpc_isolation_status_queued_pre" && m.type === "task.status.result",
        );
        if (active && queued) {
          clearInterval(interval);
          const activeTask = active.task as { id: unknown; state: unknown };
          const queuedTask = queued.task as { id: unknown; state: unknown };
          expect(activeTask.id).toBe(activeTaskId);
          expect(activeTask.state).toBe("running");
          expect(queuedTask.id).toBe(queuedTaskId);
          expect(queuedTask.state).toBe("running");
          resolve();
          return;
        }
        if (Date.now() - startedAt > 8000) {
          clearInterval(interval);
          reject(new Error(`timed out waiting for pre-abort task statuses: ${JSON.stringify(messages)}`));
        }
      }, 20);
    });

    ws.send(
      JSON.stringify({ id: "rpc_isolation_abort_active", type: "chat.abort", payload: { requestId: activeTaskId } }),
    );

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const abortResult = messages.find(
          (m) =>
            m.id === "rpc_isolation_abort_active" &&
            m.type === "chat.abort.result" &&
            m.requestId === activeTaskId &&
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

    ws.send(
      JSON.stringify({
        id: "rpc_isolation_status_active_post",
        type: "task.status",
        payload: { taskId: activeTaskId },
      }),
    );
    ws.send(
      JSON.stringify({
        id: "rpc_isolation_status_queued_post",
        type: "task.status",
        payload: { taskId: queuedTaskId },
      }),
    );

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const active = messages.find(
          (m) => m.id === "rpc_isolation_status_active_post" && m.type === "task.status.result",
        );
        const queued = messages.find(
          (m) => m.id === "rpc_isolation_status_queued_post" && m.type === "task.status.result",
        );
        if (active && queued) {
          clearInterval(interval);
          const activeTask = active.task as { id: unknown; state: unknown };
          const queuedTask = queued.task as { id: unknown; state: unknown };
          expect(activeTask.id).toBe(activeTaskId);
          expect(activeTask.state).toBe("cancelled");
          expect(queuedTask.id).toBe(queuedTaskId);
          expect(queuedTask.state).toBe("running");
          resolve();
          return;
        }
        if (Date.now() - startedAt > 8000) {
          clearInterval(interval);
          reject(new Error(`timed out waiting for post-abort task statuses: ${JSON.stringify(messages)}`));
        }
      }, 20);
    });

    ws.send(
      JSON.stringify({ id: "rpc_isolation_abort_queued", type: "chat.abort", payload: { requestId: queuedTaskId } }),
    );
    ws.close();
  }, 20_000);

  test("does not leak tool-call path args across task ids", async () => {
    const port = randomTestPort();
    const apiKey = "rpc_test_key";
    await startServerForRpcTest(port, apiKey);
    await setServerPermissionMode(port, apiKey, "write");

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

    const taskA = "rpc_task_path_iso_a";
    const taskB = "rpc_task_path_iso_b";
    const fileA = "tmp_path_iso_a.txt";
    const fileB = "tmp_path_iso_b.txt";

    ws.send(
      JSON.stringify({
        id: taskA,
        type: "chat.start",
        payload: {
          request: {
            message: `Create ${fileA} with exactly: alpha path isolation`,
            history: [],
            model: "gpt-5-mini",
            sessionId: "sess_rpc_path_iso_a",
            skipAutoVerify: true,
          },
        },
      }),
    );
    ws.send(
      JSON.stringify({
        id: taskB,
        type: "chat.start",
        payload: {
          request: {
            message: `Create ${fileB} with exactly: beta path isolation`,
            history: [],
            model: "gpt-5-mini",
            sessionId: "sess_rpc_path_iso_b",
            skipAutoVerify: true,
          },
        },
      }),
    );

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const terminalA = messages.some((m) => m.id === taskA && (m.type === "chat.done" || m.type === "chat.error"));
        const terminalB = messages.some((m) => m.id === taskB && (m.type === "chat.done" || m.type === "chat.error"));
        if (terminalA && terminalB) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 25_000) {
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

    // Model behavior is nondeterministic; enforce only the isolation invariant.
    expect(taskAArgs).not.toContain(fileB);
    expect(taskBArgs).not.toContain(fileA);

    ws.close();
  }, 35_000);
});
