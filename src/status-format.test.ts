import { describe, expect, test } from "bun:test";
import { formatStatusOutput } from "./status-format";

describe("status format", () => {
  test("formats core backend fields in stable order", () => {
    const output = formatStatusOutput(
      "provider=openai model=gpt-5-mini service=acolyte-backend url=http://localhost:6767 api_base_url=https://api.openai.com/v1 memory_storage=postgres memory_context=8 permission_mode=write",
    );

    expect(output).toBe(
      [
        "provider:       openai",
        "model:          gpt-5-mini",
        "service:        acolyte-backend",
        "url:            http://localhost:6767",
        "api_base_url:   https://api.openai.com/v1",
        "memory:         postgres",
        "memory_context: 8",
        "permissions:    write",
      ].join("\n"),
    );
  });

  test("uses mode as provider fallback when provider is absent", () => {
    const output = formatStatusOutput("mode=mock model=gpt-5-mini");
    expect(output).toBe(["provider: mock", "model:    gpt-5-mini"].join("\n"));
  });

  test("formats role models and OM fields", () => {
    const output = formatStatusOutput(
      "provider=openai model_lead=gpt-5-mini model_planner=o3 model_coder=gpt-5-codex model_reviewer=gpt-5 provider_lead=openai provider_planner=openai provider_coder=anthropic provider_reviewer=gemini provider_ready_lead=true provider_ready_planner=true provider_ready_coder=false provider_ready_reviewer=true om=enabled om_scope=resource om_model=openai/gpt-5-mini om_obs_tokens=3000 om_ref_tokens=8000",
    );

    expect(output).toContain("models:");
    expect(output).toMatch(/\n\s+lead:\s+gpt-5-mini/);
    expect(output).toMatch(/\n\s+planner:\s+o3/);
    expect(output).toMatch(/\n\s+coder:\s+gpt-5-codex/);
    expect(output).toMatch(/\n\s+reviewer:\s+gpt-5/);
    expect(output).toContain("providers:");
    expect(output).toMatch(/\n\s+lead:\s+openai/);
    expect(output).toMatch(/\n\s+planner:\s+openai/);
    expect(output).toMatch(/\n\s+coder:\s+anthropic/);
    expect(output).toMatch(/\n\s+reviewer:\s+gemini/);
    expect(output).toContain("provider_ready:");
    expect(output).toMatch(/\n\s+lead:\s+true/);
    expect(output).toMatch(/\n\s+planner:\s+true/);
    expect(output).toMatch(/\n\s+coder:\s+false/);
    expect(output).toMatch(/\n\s+reviewer:\s+true/);
    expect(output).toMatch(/om:\s+enabled/);
    expect(output).toMatch(/\n\s+scope:\s+resource/);
    expect(output).toMatch(/\n\s+model:\s+gpt-5-mini/);
    expect(output).toContain("om_tokens:");
    expect(output).toMatch(/\n\s+obs:\s+3000/);
    expect(output).toMatch(/\n\s+ref:\s+8000/);
  });

  test("omits duplicate model when model_lead matches", () => {
    const output = formatStatusOutput("provider=openai model=gpt-5-mini model_lead=gpt-5-mini model_coder=gpt-5-codex");

    expect(output).not.toContain("model:       gpt-5-mini");
    expect(output).toContain("models:");
    expect(output).toMatch(/\n\s+lead:\s+gpt-5-mini/);
    expect(output).toMatch(/\n\s+coder:\s+gpt-5-codex/);
  });

  test("strips provider prefix from model display fields", () => {
    const output = formatStatusOutput(
      "provider=openai model=openai/gpt-5-mini model_lead=openai/gpt-5-mini model_planner=anthropic/claude-sonnet-4 model_coder=gemini/gemini-2.5-pro model_reviewer=openai-compatible/qwen2.5-coder",
    );

    expect(output).not.toContain("model: openai/gpt-5-mini");
    expect(output).toMatch(/\n\s+lead:\s+gpt-5-mini/);
    expect(output).toMatch(/\n\s+planner:\s+claude-sonnet-4/);
    expect(output).toMatch(/\n\s+coder:\s+gemini-2.5-pro/);
    expect(output).toMatch(/\n\s+reviewer:\s+qwen2.5-coder/);
  });

  test("formats OM state timestamps when present", () => {
    const output = formatStatusOutput(
      "provider=openai om_exists=true om_gen=7 om_last_observed=2026-02-21T10:10:53.908Z om_last_reflection=2026-02-21T10:15:00.000Z",
    );

    expect(output).toContain("om_state:");
    expect(output).toMatch(/\n\s+exists:\s+true/);
    expect(output).toMatch(/\n\s+gen:\s+7/);
    expect(output).toMatch(/\n\s+last_observed:\s+2026-02-21T10:10:53.908Z/);
    expect(output).toMatch(/\n\s+last_reflection:\s+2026-02-21T10:15:00.000Z/);
  });

  test("keeps OM subkeys when enabled flag is absent", () => {
    const output = formatStatusOutput("provider=openai om_scope=resource om_model=openai/gpt-5-mini");

    expect(output).toContain("om:       scope: resource");
    expect(output).toContain("          model: gpt-5-mini");
  });

  test("keeps OM headline value plain when enabled is present", () => {
    const output = formatStatusOutput("provider=openai om=enabled om_scope=resource");

    expect(output).toContain("om:       enabled");
    expect(output).toContain("          scope: resource");
    expect(output).not.toContain("status: enabled");
  });

  test("aligns nested keys inside stacked groups", () => {
    const output = formatStatusOutput("provider=openai model_lead=gpt-5-mini model_planner=o3 model_reviewer=gpt-5");
    expect(output).toContain("models:");
    expect(output).toContain("          lead:     gpt-5-mini");
    expect(output).toContain("          planner:  o3");
    expect(output).toContain("          reviewer: gpt-5");
  });

  test("omits provider readiness section when all providers are ready", () => {
    const output = formatStatusOutput(
      "provider=openai provider_ready_lead=true provider_ready_planner=true provider_ready_coder=true provider_ready_reviewer=true",
    );
    expect(output).not.toContain("provider_ready:");
  });

  test("shows provider readiness section when any provider is not ready", () => {
    const output = formatStatusOutput(
      "provider=openai provider_ready_lead=true provider_ready_planner=true provider_ready_coder=false provider_ready_reviewer=true",
    );
    expect(output).toContain("provider_ready:");
    expect(output).toContain("coder:    false");
  });
});
