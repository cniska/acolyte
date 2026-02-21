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
      "provider=openai model_main=gpt-5-mini model_planner=o3 model_coder=gpt-5-codex model_reviewer=gpt-5 om=enabled om_scope=resource om_model=openai/gpt-5-mini om_obs_tokens=3000 om_ref_tokens=8000",
    );

    expect(output).toContain("models:    main: gpt-5-mini");
    expect(output).toContain("           planner: o3");
    expect(output).toContain("           coder: gpt-5-codex");
    expect(output).toContain("           reviewer: gpt-5");
    expect(output).toContain("om:        enabled");
    expect(output).toContain("           scope: resource");
    expect(output).toContain("           model: openai/gpt-5-mini");
    expect(output).toContain("om_tokens: obs: 3000");
    expect(output).toContain("           ref: 8000");
  });
});
