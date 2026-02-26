import { describe, expect, test } from "bun:test";
import { formatStatusOutput } from "./status-format";

describe("status format", () => {
  test("formats core backend fields in stable order", () => {
    const output = formatStatusOutput(
      "provider=openai model=gpt-5-mini service=acolyte-backend url=http://localhost:6767 provider_api_url=https://api.openai.com/v1 memory_storage=postgres memory_context=8 permission_mode=write",
    );

    expect(output).toMatch(/provider:\s+openai/);
    expect(output).toMatch(/\n\s+api_url:\s+https:\/\/api\.openai\.com\/v1/);
    expect(output).toMatch(/model:\s+gpt-5-mini/);
    expect(output).toMatch(/service:\s+acolyte-backend/);
    expect(output).toMatch(/\n\s+url:\s+http:\/\/localhost:6767/);
    expect(output).toMatch(/memory:\s+postgres/);
    expect(output).toMatch(/\n\s+entries:\s+8/);
    expect(output).toMatch(/permissions:\s+write/);
  });

  test("uses mode as provider fallback when provider is absent", () => {
    const output = formatStatusOutput("mode=mock model=gpt-5-mini");
    expect(output).toBe(["provider: mock", "model:    gpt-5-mini"].join("\n"));
  });

  test("formats model/provider and OM fields", () => {
    const output = formatStatusOutput(
      "provider=openai model=gpt-5-mini provider_ready=false om=enabled om_scope=resource om_model=openai/gpt-5-mini om_obs_tokens=3000 om_ref_tokens=8000",
    );

    expect(output).toMatch(/model:\s+gpt-5-mini/);
    expect(output).toMatch(/provider:\s+openai/);
    expect(output).not.toContain("provider_ready:");
    expect(output).not.toContain("not ready");
    expect(output).toMatch(/om:\s+enabled/);
    expect(output).toMatch(/\n\s+scope:\s+resource/);
    expect(output).toMatch(/\n\s+model:\s+gpt-5-mini/);
    expect(output).toMatch(/\n\s+tokens:\s+obs=3000 ref=8000/);
  });

  test("strips provider prefix from model display fields", () => {
    const output = formatStatusOutput("provider=openai model=openai/gpt-5-mini");

    expect(output).not.toContain("model: openai/gpt-5-mini");
    expect(output).toMatch(/model:\s+gpt-5-mini/);
  });

  test("formats OM state timestamps when present", () => {
    const output = formatStatusOutput(
      "provider=openai om_exists=true om_gen=7 om_last_observed=2026-02-21T10:10:53.908Z om_last_reflection=2026-02-21T10:15:00.000Z",
    );

    expect(output).toMatch(/state:\s+exists=true gen=7/);
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
    const output = formatStatusOutput("provider=openai model=gpt-5-mini om=enabled om_scope=resource");
    expect(output).toMatch(/model:\s+gpt-5-mini/);
    expect(output).toContain("          scope: resource");
  });

  test("drops provider_ready field from output", () => {
    const output = formatStatusOutput("provider=openai provider_ready=false");
    expect(output).toMatch(/provider:\s+openai$/m);
    expect(output).not.toContain("provider_ready");
    expect(output).not.toContain("not ready");
  });
});
