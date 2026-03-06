import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMessagePayload,
  createToolCallsPayload,
  type FakeProviderHandler,
  pickFunctionToolName,
  withFakeProviderServer,
} from "../scripts/fake-provider-server";
import { createClient } from "./client";
import { waitForServer } from "./wait-server";

const repoRoot = process.cwd();
const tmpHomes: string[] = [];
const tmpProjects: string[] = [];
const serverProcs: Bun.Subprocess[] = [];
const TEST_MODEL = "gpt-5-mini";
type ReplyStreamResult = Awaited<ReturnType<ReturnType<typeof createClient>["replyStream"]>>;

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

function reserveFreePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = probe.port;
  probe.stop(true);
  if (typeof port !== "number") throw new Error("Failed to reserve free port");
  return port;
}

async function runGuardIntegrationScenario(
  message: string,
  sessionId: string,
  handleRequest: FakeProviderHandler,
): Promise<ReplyStreamResult> {
  return withFakeProviderServer(
    async (providerBaseUrl) => {
      const home = await mkdtemp(join(tmpdir(), "acolyte-guard-int-home-"));
      const project = await mkdtemp(join(tmpdir(), "acolyte-guard-int-project-"));
      tmpHomes.push(home);
      tmpProjects.push(project);

      const port = reserveFreePort();

      await mkdir(join(home, ".acolyte"), { recursive: true });
      await mkdir(join(project, ".acolyte"), { recursive: true });
      await writeFile(
        join(project, ".acolyte", "config.toml"),
        [
          `port = ${port}`,
          `model = "${TEST_MODEL}"`,
          `openaiBaseUrl = ${JSON.stringify(providerBaseUrl)}`,
          'permissionMode = "write"',
          "",
        ].join("\n"),
        "utf8",
      );

      const serverProc = Bun.spawn([process.execPath, "run", join(repoRoot, "src/server.ts")], {
        cwd: project,
        env: {
          ...process.env,
          HOME: home,
          OPENAI_BASE_URL: providerBaseUrl,
          OPENAI_API_KEY: "test-key",
          NO_COLOR: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      serverProcs.push(serverProc);

      await waitForServer(`http://127.0.0.1:${port}/v1/status`, 10_000);

      const client = createClient({ apiUrl: `http://127.0.0.1:${port}` });
      return client.replyStream(
        {
          message,
          history: [],
          model: TEST_MODEL,
          sessionId,
          workspace: project,
        },
        { onEvent: () => {} },
      );
    },
    { handleRequest },
  );
}

describe("guard regression integration", () => {
  test("duplicate-consecutive-call guard blocks sequential duplicate tool calls", async () => {
    const reply = await runGuardIntegrationScenario(
      "[int:duplicate-consecutive-call] Run the same harmless command eight times in a row.",
      "sess_guard-regression-duplicate",
      ({ model, responseCounter, sourceText, outputs, body }) => {
        if (sourceText.includes("[int:duplicate-consecutive-call]")) {
          const toolName = pickFunctionToolName(body.tools, "run-command", ["run", "command", "terminal"]);
          if (outputs.length === 0) {
            return createToolCallsPayload(model, responseCounter, [
              {
                id: "fc_duplicate_1",
                callId: "call_duplicate_1",
                name: toolName,
                args: JSON.stringify({ command: "echo duplicate-guard-check" }),
              },
            ]);
          }

          const lastCallId = outputs[outputs.length - 1]?.callId;
          if (lastCallId === "call_duplicate_1") {
            return createToolCallsPayload(model, responseCounter, [
              {
                id: "fc_duplicate_2",
                callId: "call_duplicate_2",
                name: toolName,
                args: JSON.stringify({ command: "echo duplicate-guard-check" }),
              },
            ]);
          }

          return createMessagePayload(model, responseCounter, "Done.");
        }
        return createMessagePayload(model, responseCounter, "ok");
      },
    );

    expect(reply.output).toContain("Done");
    expect(Array.isArray(reply.toolCalls)).toBe(true);
    expect(reply.toolCalls?.length).toBe(1);
    expect(reply.toolCalls?.[0]).toBe("run-command");
  }, 20_000);

  test("verify-ran guard blocks second verify command when no writes occurred", async () => {
    const reply = await runGuardIntegrationScenario(
      "[int:verify-ran] Run verify twice without changing any files.",
      "sess_guard-regression-verify-ran",
      ({ model, responseCounter, sourceText, outputs, body }) => {
        if (sourceText.includes("[int:verify-ran]")) {
          const toolName = pickFunctionToolName(body.tools, "run-command", ["run", "command", "terminal"]);
          if (outputs.length === 0) {
            return createToolCallsPayload(model, responseCounter, [
              {
                id: "fc_verify_1",
                callId: "call_verify_1",
                name: toolName,
                args: JSON.stringify({ command: "echo verify pass-one" }),
              },
            ]);
          }

          const lastCallId = outputs[outputs.length - 1]?.callId;
          if (lastCallId === "call_verify_1") {
            return createToolCallsPayload(model, responseCounter, [
              {
                id: "fc_verify_2",
                callId: "call_verify_2",
                name: toolName,
                args: JSON.stringify({ command: "echo verify pass-two" }),
              },
            ]);
          }

          return createMessagePayload(model, responseCounter, "Done.");
        }
        return createMessagePayload(model, responseCounter, "ok");
      },
    );

    expect(reply.output).toContain("Done");
    expect(reply.toolCalls).toEqual(["run-command"]);
  }, 20_000);

  test("no-shell-read-fallback guard blocks shell read fallback commands", async () => {
    const reply = await runGuardIntegrationScenario(
      "[int:no-shell-read-fallback] Try shell read fallback, then use read-file.",
      "sess_guard-regression-no-shell-read-fallback",
      ({ model, responseCounter, sourceText, outputs, body }) => {
        if (sourceText.includes("[int:no-shell-read-fallback]")) {
          const runToolName = pickFunctionToolName(body.tools, "run-command", ["run", "command", "terminal"]);
          const readToolName = pickFunctionToolName(body.tools, "read-file", ["read", "file"]);
          if (outputs.length === 0) {
            return createToolCallsPayload(model, responseCounter, [
              {
                id: "fc_shell_read_1",
                callId: "call_shell_read_1",
                name: runToolName,
                args: JSON.stringify({ command: "cat src/lifecycle.ts" }),
              },
            ]);
          }

          const lastCallId = outputs[outputs.length - 1]?.callId;
          if (lastCallId === "call_shell_read_1") {
            return createToolCallsPayload(model, responseCounter, [
              {
                id: "fc_read_file_1",
                callId: "call_read_file_1",
                name: readToolName,
                args: JSON.stringify({ paths: [{ path: "src/lifecycle.ts" }] }),
              },
            ]);
          }

          return createMessagePayload(model, responseCounter, "Done.");
        }
        return createMessagePayload(model, responseCounter, "ok");
      },
    );

    expect(reply.output).toContain("Done");
    expect(reply.toolCalls).toEqual(["read-file"]);
  }, 20_000);

  test("no-rewrite guard blocks delete-file after reading the same file", async () => {
    const reply = await runGuardIntegrationScenario(
      "[int:no-rewrite] Read a file and then try to delete it.",
      "sess_guard-regression-no-rewrite",
      ({ model, responseCounter, sourceText, outputs, body }) => {
        if (sourceText.includes("[int:no-rewrite]")) {
          const readToolName = pickFunctionToolName(body.tools, "read-file", ["read", "file"]);
          const deleteToolName = pickFunctionToolName(body.tools, "delete-file", ["delete", "file"]);
          if (outputs.length === 0) {
            return createToolCallsPayload(model, responseCounter, [
              {
                id: "fc_read_before_delete_1",
                callId: "call_read_before_delete_1",
                name: readToolName,
                args: JSON.stringify({ paths: [{ path: "src/lifecycle.ts" }] }),
              },
            ]);
          }

          const lastCallId = outputs[outputs.length - 1]?.callId;
          if (lastCallId === "call_read_before_delete_1") {
            return createToolCallsPayload(model, responseCounter, [
              {
                id: "fc_delete_after_read_1",
                callId: "call_delete_after_read_1",
                name: deleteToolName,
                args: JSON.stringify({ paths: ["src/lifecycle.ts"] }),
              },
            ]);
          }

          return createMessagePayload(model, responseCounter, "Done.");
        }
        return createMessagePayload(model, responseCounter, "ok");
      },
    );

    expect(reply.output).toContain("Done");
    expect(reply.toolCalls).toEqual(["read-file"]);
  }, 20_000);
});
