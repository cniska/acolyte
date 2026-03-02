import {
  createMessagePayload,
  createToolCallsPayload,
  pickFunctionToolName,
  type FakeProviderRequestContext,
} from "./fake-provider-server";

export type ScenarioId = "quick-answer" | "tool-read-roundtrip" | "edit-then-verify";

export type Scenario = {
  id: ScenarioId;
  description: string;
  prompt: string;
};

export type PerfScenario = Scenario & {
  marker: string;
  handle: (ctx: FakeProviderRequestContext) => Record<string, unknown>;
};

export const PERF_SCENARIOS: PerfScenario[] = [
  {
    id: "quick-answer",
    marker: "[perf:quick-answer]",
    description: "No-tool baseline (model-only response).",
    prompt: '[perf:quick-answer] Reply with exactly "ok".',
    handle: (ctx) => createMessagePayload(ctx.model, ctx.responseCounter, "ok"),
  },
  {
    id: "tool-read-roundtrip",
    marker: "[perf:tool-read-roundtrip]",
    description: "One read-file call followed by a short answer.",
    prompt: "[perf:tool-read-roundtrip] Read src/lifecycle.ts and summarize in one short sentence.",
    handle: (ctx) => {
      const readTool = pickFunctionToolName(ctx.body.tools, "read-file", ["read", "file"]);
      if (ctx.outputs.length === 0) {
        return createToolCallsPayload(ctx.model, ctx.responseCounter, [
          {
            id: "fc_read_1",
            callId: "call_read_1",
            name: readTool,
            args: JSON.stringify({ paths: [{ path: "src/lifecycle.ts" }] }),
          },
        ]);
      }
      return createMessagePayload(ctx.model, ctx.responseCounter, "Lifecycle is a 5-phase request pipeline.");
    },
  },
  {
    id: "edit-then-verify",
    marker: "[perf:edit-then-verify]",
    description: "One edit-file call followed by one run-command verify call.",
    prompt: "[perf:edit-then-verify] Edit src/lifecycle.ts and run verification once, then answer briefly.",
    handle: (ctx) => {
      const editTool = pickFunctionToolName(ctx.body.tools, "edit-file", ["edit", "file"]);
      const runTool = pickFunctionToolName(ctx.body.tools, "run-command", ["run", "command", "terminal"]);
      const lastCallId = ctx.outputs[ctx.outputs.length - 1]?.callId;

      if (ctx.outputs.length === 0) {
        return createToolCallsPayload(ctx.model, ctx.responseCounter, [
          {
            id: "fc_edit_1",
            callId: "call_edit_1",
            name: editTool,
            args: JSON.stringify({
              path: "src/lifecycle.ts",
              edits: [{ find: "return 'ok';", replace: "return 'ok';" }],
            }),
          },
        ]);
      }

      if (lastCallId === "call_edit_1") {
        return createToolCallsPayload(ctx.model, ctx.responseCounter, [
          {
            id: "fc_run_1",
            callId: "call_run_1",
            name: runTool,
            args: JSON.stringify({ command: "bun test" }),
          },
        ]);
      }

      return createMessagePayload(ctx.model, ctx.responseCounter, "Done.");
    },
  },
];

export const PERF_SCENARIO_LIST: Scenario[] = PERF_SCENARIOS.map(({ id, description, prompt }) => ({
  id,
  description,
  prompt,
}));

export const PERF_SCENARIO_BY_ID: Record<ScenarioId, PerfScenario> = {
  "quick-answer": PERF_SCENARIOS[0],
  "tool-read-roundtrip": PERF_SCENARIOS[1],
  "edit-then-verify": PERF_SCENARIOS[2],
};

export function parseScenarioIdFromMarker(sourceText: string): ScenarioId | null {
  const scenario = PERF_SCENARIOS.find((entry) => sourceText.includes(entry.marker));
  return scenario?.id ?? null;
}
