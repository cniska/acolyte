import { describe, expect, test } from "bun:test";
import { formatStatusOutput } from "./status-format";

describe("status format", () => {
  test("formats core fields as flat key-value pairs", () => {
    const output = formatStatusOutput(
      "provider=openai model=gpt-5-mini service=acolyte-backend url=http://localhost:6767 provider_api_url=https://api.openai.com/v1 memory_storage=postgres memory_context=8 permission_mode=write",
    );

    expect(output).toMatch(/^provider:\s+openai$/m);
    expect(output).toMatch(/^model:\s+gpt-5-mini$/m);
    expect(output).toMatch(/^permissions:\s+write$/m);
    expect(output).toMatch(/^service:\s+acolyte-backend \(http:\/\/localhost:6767\)$/m);
    expect(output).toMatch(/^memory:\s+postgres \(8 entries\)$/m);
    expect(output).not.toContain("api_url");
  });

  test("uses mode as provider fallback", () => {
    const output = formatStatusOutput("mode=mock model=gpt-5-mini");
    expect(output).toMatch(/^provider:\s+mock$/m);
    expect(output).toMatch(/^model:\s+gpt-5-mini$/m);
  });

  test("strips provider prefix from model", () => {
    const output = formatStatusOutput("provider=openai model=openai/gpt-5-mini");
    expect(output).toMatch(/^model:\s+gpt-5-mini$/m);
    expect(output).not.toContain("openai/");
  });

  test("shows explore model when present", () => {
    const output = formatStatusOutput("provider=openai model=openai/gpt-5 explore_model=openai/gpt-5-mini");
    expect(output).toMatch(/^model:\s+gpt-5$/m);
    expect(output).toMatch(/^explore:\s+gpt-5-mini$/m);
  });

  test("drops provider_ready from output", () => {
    const output = formatStatusOutput("provider=openai provider_ready=false");
    expect(output).not.toContain("provider_ready");
  });

  test("compacts om to single line", () => {
    const output = formatStatusOutput(
      "provider=openai om=enabled om_scope=resource om_model=openai/gpt-5-mini om_obs_tokens=3000 om_ref_tokens=8000",
    );
    expect(output).toMatch(/^om:\s+enabled \(resource\)$/m);
    expect(output).not.toContain("om_scope");
    expect(output).not.toContain("om_model");
    expect(output).not.toContain("om_obs_tokens");
  });
});
