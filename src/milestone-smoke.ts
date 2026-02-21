#!/usr/bin/env bun
import { appConfig } from "./app-config";

async function run(cmd: string): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(["bash", "-lc", cmd], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: `${stdout}${stderr}`.trim() };
}

function printStep(name: string, ok: boolean, details?: string): void {
  const mark = ok ? "✓" : "✗";
  console.log(`${mark} ${name}`);
  if (details && details.length > 0) {
    console.log(details);
  }
}

async function main(): Promise<void> {
  const url = appConfig.server.apiUrl?.trim() || `http://localhost:${appConfig.server.port}`;
  console.log(`Running milestone smoke against ${url}`);

  const status = await run("bun run status");
  printStep("status command", status.code === 0, status.code === 0 ? undefined : status.out);

  const whatNext = await run('bun run run "what next"');
  printStep('run "what next"', whatNext.code === 0, whatNext.code === 0 ? undefined : whatNext.out);

  const omStatus = await run("bun run om:status");
  printStep("om:status", omStatus.code === 0, omStatus.code === 0 ? undefined : omStatus.out);

  const omWipeNoYes = await run("bun run om:wipe");
  const omWipeGuarded = omWipeNoYes.code !== 0 && omWipeNoYes.out.includes("--yes");
  printStep("om:wipe safety guard", omWipeGuarded, omWipeGuarded ? undefined : omWipeNoYes.out);

  const allOk = status.code === 0 && whatNext.code === 0 && omStatus.code === 0 && omWipeGuarded;
  if (!allOk) {
    process.exitCode = 1;
    return;
  }

  console.log("Milestone smoke passed.");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
