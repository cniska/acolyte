import { describe, expect, test } from "bun:test";
import { formatStatusOutput } from "./status-format";

describe("status format", () => {
  test("formats core backend fields in stable order", () => {
    const output = formatStatusOutput(
      "provider=openai model=gpt-5-mini service=acolyte-backend url=http://localhost:6767 memory_storage=postgres",
    );

    expect(output).toBe(
      [
        "provider: openai",
        "model:    gpt-5-mini",
        "service:  acolyte-backend",
        "url:      http://localhost:6767",
        "memory:   postgres",
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

    expect(output).toContain("models:    main=gpt-5-mini planner=o3 coder=gpt-5-codex reviewer=gpt-5");
    expect(output).toContain("om:        enabled scope=resource model=openai/gpt-5-mini");
    expect(output).toContain("om_tokens: obs=3000 ref=8000");
  });
});
