const STRIP_ANSI_REGEX = /\u001b\[[0-9;]*m/g;

type SmokeCheck = {
  name: string;
  command: string;
  expect: RegExp[];
  allowFailure?: boolean;
};

type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

const checks: SmokeCheck[] = [
  {
    name: "status",
    command: "bun run src/cli.ts status",
    expect: [/provider:/i, /model:/i],
  },
  {
    name: 'run "hello"',
    command: 'bun run src/cli.ts run "hello"',
    expect: [/^❯\s+hello/m, /^\s*•\s+/m],
  },
  {
    name: "dogfood no-verify",
    command: 'bun run src/cli.ts dogfood --no-verify "ping"',
    expect: [/Immediate action:/i],
  },
];

async function runCommand(command: string): Promise<RunResult> {
  const proc = Bun.spawn(["bash", "-lc", command], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function stripAnsi(value: string): string {
  return value.replaceAll(STRIP_ANSI_REGEX, "");
}

function assertCheckOutput(check: SmokeCheck, output: string): string | null {
  for (const pattern of check.expect) {
    if (!pattern.test(output)) {
      return `missing expected pattern ${pattern}`;
    }
  }
  return null;
}

async function main(): Promise<void> {
  console.log("Running dogfood smoke checks...");
  for (const check of checks) {
    const result = await runCommand(check.command);
    const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
    if (result.exitCode !== 0 && !check.allowFailure) {
      console.error(`✗ ${check.name}: command failed (exit ${result.exitCode})`);
      if (check.name === "status" && /unable to connect/i.test(output)) {
        console.error(
          "Hint: start backend first (`bun run serve:env`) and ensure apiUrl is set to http://localhost:6767.",
        );
      }
      console.error(output.trim());
      process.exit(1);
    }
    const assertionError = assertCheckOutput(check, output);
    if (assertionError) {
      console.error(`✗ ${check.name}: ${assertionError}`);
      console.error(output.trim());
      process.exit(1);
    }
    console.log(`✓ ${check.name}`);
  }

  console.log("Dogfood smoke checks passed.");
}

void main();
