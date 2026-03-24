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
import { waitForServer } from "../scripts/wait-server";
import { createClient } from "./client-factory";

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

      await waitForServer(`http://127.0.0.1:${port}/healthz`, 15_000);

      const client = createClient({ apiUrl: `http://127.0.0.1:${port}` });
      return client.replyStream(
        {
          message,
          history: [],
          model: TEST_MODEL,
          sessionId,
          workspace: project,
          requestedMode: "work",
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
      "sess_guardregressionduplicate",
      ({ model, responseCounter, outputs, body }) => {
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

        return createMessagePayload(model, responseCounter, "Done.\n@signal done");
      },
    );

    expect(reply.output).toContain("Done");
    expect(Array.isArray(reply.toolCalls)).toBe(true);
    expect(reply.toolCalls?.length).toBe(1);
    expect(reply.toolCalls?.[0]).toBe("run-command");
  }, 20_000);
});
