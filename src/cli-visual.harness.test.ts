import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { usage } from "./cli-command-registry";
import { captureCliOutput } from "./cli-test-harness";
import { updateMode } from "./cli-update";
import { dedent } from "./test-utils";

describe("cli visual regression (harness)", () => {
  test("top-level help output stays stable", async () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    const out = await captureCliOutput(() => {
      usage(packageJson.version);
    });
    expect(out).toBe(
      dedent(`
      Acolyte v${packageJson.version}

      Usage
        acolyte
        acolyte <COMMAND> [ARGS]

      Commands
        init [provider]        initialize provider API key
        resume [id]            resume previous session
        run <prompt>           run a single prompt
        history                show recent sessions
        start                  start server
        stop                   stop all servers
        restart                restart server
        ps                     list running servers
        status                 show server status
        memory                 manage memory
        config                 manage config
        skill <name> [prompt]  run a prompt with an active skill
        logs                   view server logs
        update                 check for and install updates
        trace                  inspect server lifecycle traces

      Options
        -h, --help             print help
        -V, --version          print version
        --update               check for updates before running
        --no-update            disable update checks
    `),
    );
  });

  test("update command prints network error when github api is unavailable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (..._args: Parameters<typeof fetch>) =>
      new Response("no", { status: 503 })) as unknown as typeof fetch;
    try {
      const out = await captureCliOutput(async () => {
        await updateMode();
      });
      expect(out).toBe("Could not check for updates. Check your network connection.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
