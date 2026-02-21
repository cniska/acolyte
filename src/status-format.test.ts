import { describe, expect, test } from "bun:test";
import { formatStatusOutput } from "./status-format";

describe("status format", () => {
  test("formats core backend fields in stable order", () => {
    const output = formatStatusOutput(
      "provider=openai model=gpt-5-mini service=acolyte-backend url=http://localhost:6767 api_base_url=https://api.openai.com/v1 memory_storage=postgres permission_mode=write",
    );

    expect(output).toBe(
      [
        "provider:     openai",
        "model:        gpt-5-mini",
        "service:      acolyte-backend",
        "url:          http://localhost:6767",
        "api_base_url: https://api.openai.com/v1",
        "memory:       postgres",
        "permissions:  write",
      ].join("\n"),
    );
  });

  test("uses mode as provider fallback when provider is absent", () => {
    const output = formatStatusOutput("mode=mock model=gpt-5-mini");
    expect(output).toBe(["provider: mock", "model:    gpt-5-mini"].join("\n"));
  });

  test("formats role models and OM fields", () => {
    const output = formatStatusOutput(
      "provider=openai model_main=gpt-5-mini model_planner=o3 model_coder=gpt-5-codex model_reviewer=gpt-5 provider_main=openai provider_planner=openai provider_coder=anthropic provider_reviewer=gemini provider_ready_main=true provider_ready_planner=true provider_ready_coder=false provider_ready_reviewer=true om=enabled om_scope=resource om_model=openai/gpt-5-mini om_obs_tokens=3000 om_ref_tokens=8000",
    );

    expect(output).toContain("models:");
    expect(output).toContain("           main: gpt-5-mini");
    expect(output).toContain("           planner: o3");
    expect(output).toContain("           coder: gpt-5-codex");
    expect(output).toContain("           reviewer: gpt-5");
    expect(output).toContain("providers:");
    expect(output).toContain("           main: openai");
    expect(output).toContain("           planner: openai");
    expect(output).toContain("           coder: anthropic");
    expect(output).toContain("           reviewer: gemini");
    expect(output).toContain("provider_ready:");
    expect(output).toContain("               main: true");
    expect(output).toContain("               planner: true");
    expect(output).toContain("               coder: false");
    expect(output).toContain("               reviewer: true");
    expect(output).toMatch(/om:\s+enabled/);
    expect(output).toContain("           scope: resource");
    expect(output).toContain("           model: openai/gpt-5-mini");
    expect(output).toContain("om_tokens:");
    expect(output).toContain("           obs: 3000");
    expect(output).toContain("           ref: 8000");
  });

  test("omits duplicate model when model_main matches", () => {
    const output = formatStatusOutput("provider=openai model=gpt-5-mini model_main=gpt-5-mini model_coder=gpt-5-codex");

    expect(output).not.toContain("model:       gpt-5-mini");
    expect(output).toContain("models:");
    expect(output).toContain("main: gpt-5-mini");
    expect(output).toContain("coder: gpt-5-codex");
  });

  test("formats OM state timestamps when present", () => {
    const output = formatStatusOutput(
      "provider=openai om_exists=true om_gen=7 om_last_observed=2026-02-21T10:10:53.908Z om_last_reflection=2026-02-21T10:15:00.000Z",
    );

    expect(output).toContain("om_state:");
    expect(output).toContain("exists: true");
    expect(output).toContain("gen: 7");
    expect(output).toContain("last_observed: 2026-02-21T10:10:53.908Z");
    expect(output).toContain("last_reflection: 2026-02-21T10:15:00.000Z");
  });

  test("keeps OM subkeys when enabled flag is absent", () => {
    const output = formatStatusOutput("provider=openai om_scope=resource om_model=openai/gpt-5-mini");

    expect(output).toContain("om:       scope: resource");
    expect(output).toContain("          model: openai/gpt-5-mini");
  });

  test("keeps OM headline value plain when enabled is present", () => {
    const output = formatStatusOutput("provider=openai om=enabled om_scope=resource");

    expect(output).toContain("om:       enabled");
    expect(output).toContain("          scope: resource");
    expect(output).not.toContain("status: enabled");
  });
});
