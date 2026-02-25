import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type SmokeCheck = {
  name: string;
  cmd: string[];
  expect: RegExp[];
  allowFailure?: boolean;
};

type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type SmokeArgs = {
  requireProviderReady: boolean;
};

const COMMAND_TIMEOUT_MS = 120_000;

export const checks: SmokeCheck[] = [
  {
    name: "status",
    cmd: ["bun", "run", "src/cli.ts", "status"],
    expect: [/provider:/i, /(?:model|backend|service):/i],
  },
  {
    name: 'run "hello"',
    cmd: ["bun", "run", "src/cli.ts", "run", "hello"],
    expect: [/^❯\s+hello/m, /^\s*•\s+/m],
  },
  {
    name: "dogfood no-verify",
    cmd: ["bun", "run", "src/cli.ts", "dogfood", "--no-verify", "ping"],
    expect: [/^❯\s+ping/m, /^\s*•\s+/m],
  },
  {
    name: "memory context all",
    cmd: ["bun", "run", "src/cli.ts", "memory", "context", "all"],
    expect: [/scope:\s+all/i, /memory_context:\s+\d+/i],
  },
];

export async function runCommand(
  cmd: string[],
  timeoutMs = COMMAND_TIMEOUT_MS,
  envOverride?: Record<string, string>,
): Promise<RunResult> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", ...envOverride },
  });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const completed = Promise.all([stdoutPromise, stderrPromise, proc.exited]).then(([stdout, stderr, exitCode]) => ({
    exitCode,
    stdout,
    stderr,
  }));

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutResult = new Promise<RunResult>((resolve) => {
    timeoutId = setTimeout(async () => {
      proc.kill();
      const [stdout, stderr] = await Promise.all([stdoutPromise.catch(() => ""), stderrPromise.catch(() => "")]);
      resolve({
        exitCode: 124,
        stdout,
        stderr: `${stderr}\nCommand timed out after ${timeoutMs}ms.`,
      });
    }, timeoutMs);
  });

  try {
    return await Promise.race([completed, timeoutResult]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

export function stripAnsi(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === "\x1b" && value[i + 1] === "[") {
      let j = i + 2;
      while (j < value.length) {
        const ch = value[j];
        if ((ch >= "0" && ch <= "9") || ch === ";") {
          j += 1;
          continue;
        }
        break;
      }
      if (value[j] === "m") {
        i = j;
        continue;
      }
    }
    out += value[i];
  }
  return out;
}

export function assertCheckOutput(check: SmokeCheck, output: string): string | null {
  for (const pattern of check.expect) {
    if (!pattern.test(output)) {
      return `missing expected pattern ${pattern}`;
    }
  }
  return null;
}

export function isProviderReadyFromStatusOutput(output: string): boolean {
  if (/provider_ready:[\s\S]*?status:\s*false/i.test(output)) {
    return false;
  }
  return true;
}

export function hasFallbackEditSignal(output: string): boolean {
  return /Applied direct edit fallback|Edit request failed:/i.test(output);
}

export function hasUnwantedVerificationChatter(output: string): boolean {
  return /\bbun run verify\b|\bverification:\b|\bnext action:\b/i.test(output);
}

export function hasAdvisoryFileWriteSignal(output: string): boolean {
  return /\bsave (?:this|as)\b|\bcopy\/paste\b|\bpaste this into\b/i.test(output);
}

export function hasToolOutcomeSignal(output: string, verb: "Wrote" | "Edited" | "Deleted"): boolean {
  const escapedVerb = verb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escapedVerb}\\s+`, "i").test(output);
}

export function parseArgs(args: string[]): SmokeArgs {
  const parsed: SmokeArgs = { requireProviderReady: false };
  for (const token of args) {
    if (token === "--require-provider-ready") {
      parsed.requireProviderReady = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return parsed;
}

function printUsage(): void {
  console.log("Usage: bun run dogfood:smoke [--require-provider-ready]");
}

async function prepareSmokeEnv(): Promise<Record<string, string>> {
  const homeDir = await mkdtemp(join(tmpdir(), "acolyte-smoke-home-"));
  await mkdir(join(homeDir, ".acolyte"), { recursive: true });
  return { HOME: homeDir };
}

async function configureSmokeCli(smokeEnv: Record<string, string>): Promise<void> {
  const setApiUrl = await runCommand(
    ["bun", "run", "src/cli.ts", "config", "set", "apiUrl", "http://localhost:6767"],
    15_000,
    smokeEnv,
  );
  if (setApiUrl.exitCode !== 0) {
    throw new Error(`Failed to set apiUrl for smoke env: ${setApiUrl.stderr || setApiUrl.stdout}`);
  }
  const setPermissions = await runCommand(
    ["bun", "run", "src/cli.ts", "config", "set", "permissionMode", "write"],
    15_000,
    smokeEnv,
  );
  if (setPermissions.exitCode !== 0) {
    throw new Error(`Failed to set permissionMode for smoke env: ${setPermissions.stderr || setPermissions.stdout}`);
  }
}

async function setBackendPermissionMode(mode: "read" | "write"): Promise<void> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (process.env.ACOLYTE_API_KEY) {
    headers.authorization = `Bearer ${process.env.ACOLYTE_API_KEY}`;
  }
  const response = await fetch("http://localhost:6767/v1/permissions", {
    method: "POST",
    headers,
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to set backend permission mode to ${mode}: ${body || `status ${response.status}`}`);
  }
}

async function runReadModeBlockSmoke(smokeEnv: Record<string, string>): Promise<{ ok: boolean; detail: string }> {
  const filePath = join(tmpdir(), `acolyte-dogfood-read-block-${crypto.randomUUID()}.txt`);
  await writeFile(filePath, "alpha\n", "utf8");
  try {
    await setBackendPermissionMode("read");
    const prompt = `Edit ${filePath}: replace alpha with beta. Apply the edit directly, no explanation.`;
    const result = await runCommand(
      ["bun", "run", "src/cli.ts", "dogfood", "--no-verify", prompt],
      COMMAND_TIMEOUT_MS,
      smokeEnv,
    );
    if (result.exitCode !== 0) {
      return { ok: false, detail: `command failed (exit ${result.exitCode})` };
    }
    const content = await readFile(filePath, "utf8");
    if (content !== "alpha\n") {
      return { ok: false, detail: "file changed despite read mode" };
    }
    return { ok: true, detail: "blocked and file unchanged" };
  } finally {
    await rm(filePath, { force: true });
    try {
      await setBackendPermissionMode("write");
    } catch {
      // best-effort restore; subsequent checks will fail if backend remains read-only
    }
  }
}

async function runCodingTaskSmoke(
  smokeEnv: Record<string, string>,
  task: {
    id: string;
    initial: string;
    prompt: (filePath: string) => string;
    validate: (content: string) => boolean;
  },
): Promise<{ ok: boolean; detail: string }> {
  const filePath = join(tmpdir(), `acolyte-dogfood-coding-${task.id}-${crypto.randomUUID()}.txt`);
  await writeFile(filePath, task.initial, "utf8");
  try {
    const prompt = task.prompt(filePath);
    const result = await runCommand(
      ["bun", "run", "src/cli.ts", "dogfood", "--no-verify", prompt],
      COMMAND_TIMEOUT_MS,
      smokeEnv,
    );
    if (result.exitCode !== 0) {
      return { ok: false, detail: `command failed (exit ${result.exitCode})` };
    }
    const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
    if (hasFallbackEditSignal(output)) {
      return { ok: false, detail: "fallback edit path used" };
    }
    if (hasAdvisoryFileWriteSignal(output)) {
      return { ok: false, detail: "advisory file-write response detected" };
    }
    if (!hasToolOutcomeSignal(output, "Edited")) {
      return { ok: false, detail: "missing edited tool outcome in output" };
    }
    const hasOutputChatter = hasUnwantedVerificationChatter(output);
    const content = await readFile(filePath, "utf8");
    if (task.validate(content)) {
      return { ok: true, detail: hasOutputChatter ? "file edited (warning: verbose output chatter)" : "file edited" };
    }
    return { ok: false, detail: "file was not edited as expected" };
  } finally {
    await rm(filePath, { force: true });
  }
}

async function runCreateFileCodingTaskSmoke(
  smokeEnv: Record<string, string>,
  task: {
    id: string;
    prompt: (filePath: string) => string;
    validate: (content: string) => boolean;
  },
): Promise<{ ok: boolean; detail: string }> {
  const filePath = join(tmpdir(), `acolyte-dogfood-create-${task.id}-${crypto.randomUUID()}.txt`);
  try {
    await rm(filePath, { force: true });
    const prompt = task.prompt(filePath);
    const result = await runCommand(
      ["bun", "run", "src/cli.ts", "dogfood", "--no-verify", prompt],
      COMMAND_TIMEOUT_MS,
      smokeEnv,
    );
    if (result.exitCode !== 0) {
      return { ok: false, detail: `command failed (exit ${result.exitCode})` };
    }
    const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
    if (hasFallbackEditSignal(output)) {
      return { ok: false, detail: "fallback edit path used" };
    }
    if (hasAdvisoryFileWriteSignal(output)) {
      return { ok: false, detail: "advisory file-write response detected" };
    }
    if (!hasToolOutcomeSignal(output, "Wrote")) {
      return { ok: false, detail: "missing wrote tool outcome in output" };
    }
    const hasOutputChatter = hasUnwantedVerificationChatter(output);
    const content = await readFile(filePath, "utf8");
    if (task.validate(content)) {
      return { ok: true, detail: hasOutputChatter ? "file created (warning: verbose output chatter)" : "file created" };
    }
    return { ok: false, detail: "file was not created as expected" };
  } catch {
    return { ok: false, detail: "file was not created as expected" };
  } finally {
    await rm(filePath, { force: true });
  }
}

async function runDeleteFileCodingTaskSmoke(
  smokeEnv: Record<string, string>,
  task: {
    id: string;
    initial: string;
    prompt: (filePath: string) => string;
  },
): Promise<{ ok: boolean; detail: string }> {
  const filePath = join(tmpdir(), `acolyte-dogfood-delete-${task.id}-${crypto.randomUUID()}.txt`);
  await writeFile(filePath, task.initial, "utf8");
  try {
    const prompt = task.prompt(filePath);
    const result = await runCommand(
      ["bun", "run", "src/cli.ts", "dogfood", "--no-verify", prompt],
      COMMAND_TIMEOUT_MS,
      smokeEnv,
    );
    if (result.exitCode !== 0) {
      return { ok: false, detail: `command failed (exit ${result.exitCode})` };
    }
    const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
    if (hasFallbackEditSignal(output)) {
      return { ok: false, detail: "fallback edit path used" };
    }
    if (hasAdvisoryFileWriteSignal(output)) {
      return { ok: false, detail: "advisory file-write response detected" };
    }
    if (!hasToolOutcomeSignal(output, "Deleted")) {
      return { ok: false, detail: "missing deleted tool outcome in output" };
    }
    try {
      await readFile(filePath, "utf8");
      return { ok: false, detail: "file still exists after delete task" };
    } catch {
      return { ok: true, detail: "file deleted" };
    }
  } finally {
    await rm(filePath, { force: true });
  }
}

async function runMultiFileCodingTaskSmoke(
  smokeEnv: Record<string, string>,
  task: {
    id: string;
    files: Array<{ name: string; initial: string }>;
    prompt: (paths: string[]) => string;
    validate: (contents: Record<string, string>) => boolean;
  },
): Promise<{ ok: boolean; detail: string }> {
  const dirPath = await mkdtemp(join(tmpdir(), `acolyte-dogfood-coding-${task.id}-`));
  const filePaths = task.files.map((file) => join(dirPath, file.name));
  try {
    for (let i = 0; i < task.files.length; i += 1) {
      await writeFile(filePaths[i], task.files[i].initial, "utf8");
    }
    const prompt = task.prompt(filePaths);
    const result = await runCommand(
      ["bun", "run", "src/cli.ts", "dogfood", "--no-verify", prompt],
      COMMAND_TIMEOUT_MS,
      smokeEnv,
    );
    if (result.exitCode !== 0) {
      return { ok: false, detail: `command failed (exit ${result.exitCode})` };
    }
    const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
    if (hasFallbackEditSignal(output)) {
      return { ok: false, detail: "fallback edit path used" };
    }
    if (hasAdvisoryFileWriteSignal(output)) {
      return { ok: false, detail: "advisory file-write response detected" };
    }
    if (!hasToolOutcomeSignal(output, "Edited")) {
      return { ok: false, detail: "missing edited tool outcome in output" };
    }
    const hasOutputChatter = hasUnwantedVerificationChatter(output);
    const contents: Record<string, string> = {};
    for (const filePath of filePaths) {
      contents[filePath] = await readFile(filePath, "utf8");
    }
    if (task.validate(contents)) {
      return {
        ok: true,
        detail: hasOutputChatter ? "files edited (warning: verbose output chatter)" : "files edited",
      };
    }
    return { ok: false, detail: "files were not edited as expected" };
  } finally {
    await rm(dirPath, { recursive: true, force: true });
  }
}

export async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }
  const args = parseArgs(argv);

  console.log("Running dogfood smoke checks...");
  const smokeEnv = await prepareSmokeEnv();
  try {
    try {
      await configureSmokeCli(smokeEnv);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Failed to configure smoke environment");
      process.exit(1);
      return;
    }

    let statusOutput = "";
    for (const check of checks) {
      const result = await runCommand(check.cmd, COMMAND_TIMEOUT_MS, smokeEnv);
      const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
      if (check.name === "status") {
        statusOutput = output;
      }
      if (result.exitCode !== 0 && !check.allowFailure) {
        console.error(`✗ ${check.name}: command failed (exit ${result.exitCode})`);
        if (check.name === "status" && /unable to connect/i.test(output)) {
          console.error(
            "Hint: start backend first (`bun run serve:env`) and ensure apiUrl is set to http://localhost:6767.",
          );
          console.error("Or run `bun run dogfood:smoke` to auto-start a local backend for the smoke check.");
        }
        console.error(output.trim());
        process.exit(1);
        return;
      }
      const assertionError = assertCheckOutput(check, output);
      if (assertionError) {
        console.error(`✗ ${check.name}: ${assertionError}`);
        console.error(output.trim());
        process.exit(1);
        return;
      }
      console.log(`✓ ${check.name}`);
    }

    const readModeBlock = await runReadModeBlockSmoke(smokeEnv);
    if (!readModeBlock.ok) {
      console.error(`✗ dogfood read-mode block: ${readModeBlock.detail}`);
      process.exit(1);
      return;
    }
    console.log("✓ dogfood read-mode block");

    if (isProviderReadyFromStatusOutput(statusOutput)) {
      const codingTasks = [
        {
          id: "replace",
          label: "dogfood coding task replace",
          initial: "alpha\n",
          prompt: (filePath: string) =>
            [
              `Target file: ${filePath}`,
              "Task: replace alpha with beta.",
              "Use edit-file on the target path and write the change directly.",
              "Do not only read/search; complete the edit.",
              "Return a concise summary only.",
            ].join("\n"),
          validate: (content: string) => content.includes("beta") && !content.includes("alpha"),
        },
        {
          id: "insert",
          label: "dogfood coding task insert",
          initial: "alpha\nbeta\n",
          prompt: (filePath: string) =>
            [
              `Target file: ${filePath}`,
              'Task: replace "beta" with "beta\\ngamma".',
              "Use edit-file on the target path and write the change directly.",
              "Do not only read/search; complete the edit.",
              "Return a concise summary only.",
            ].join("\n"),
          validate: (content: string) => content.includes("beta\ngamma"),
        },
        {
          id: "multiline-structure",
          label: "dogfood coding task multiline structure",
          initial: ["# Notes", "", "## Tasks", "- [ ] alpha", "- [ ] beta", ""].join("\n"),
          prompt: (filePath: string) =>
            [
              `Target file: ${filePath}`,
              "Task: apply all changes below in one edit:",
              '1) Rename heading "## Tasks" to "## Plan".',
              '2) Change "- [ ] alpha" to "- [x] alpha".',
              "3) Append a new section at end:",
              "## Done",
              "- alpha",
              "Use edit-file on the target path and write the change directly.",
              "Do not only read/search; complete the edit.",
              "Return a concise summary only.",
            ].join("\n"),
          validate: (content: string) =>
            content.includes("## Plan") &&
            !content.includes("## Tasks") &&
            content.includes("- [x] alpha") &&
            content.includes("## Done") &&
            content.includes("- alpha"),
        },
      ] as const;
      for (const task of codingTasks) {
        const codingTask = await runCodingTaskSmoke(smokeEnv, task);
        if (!codingTask.ok) {
          console.error(`✗ ${task.label}: ${codingTask.detail}`);
          process.exit(1);
          return;
        }
        console.log(`✓ ${task.label}`);
      }
      const createFileTask = await runCreateFileCodingTaskSmoke(smokeEnv, {
        id: "create-file",
        prompt: (filePath: string) =>
          [
            `Target file: ${filePath}`,
            "Task: create this file with exactly two lines:",
            "alpha",
            "beta",
            "Use write-file on the target path and write the file directly.",
            "Return a concise summary only.",
          ].join("\n"),
        validate: (content: string) => content.trim() === "alpha\nbeta",
      });
      if (!createFileTask.ok) {
        console.error(`✗ dogfood coding task create file: ${createFileTask.detail}`);
        process.exit(1);
        return;
      }
      console.log("✓ dogfood coding task create file");
      const deleteFileTask = await runDeleteFileCodingTaskSmoke(smokeEnv, {
        id: "delete-file",
        initial: "alpha\nbeta\n",
        prompt: (filePath: string) =>
          [
            `Target file: ${filePath}`,
            "Task: delete this file.",
            "Use delete-file on the target path and execute directly.",
            "Return a concise summary only.",
          ].join("\n"),
      });
      if (!deleteFileTask.ok) {
        console.error(`✗ dogfood coding task delete file: ${deleteFileTask.detail}`);
        process.exit(1);
        return;
      }
      console.log("✓ dogfood coding task delete file");

      const multiFileTask = await runMultiFileCodingTaskSmoke(smokeEnv, {
        id: "multifile",
        files: [
          {
            name: "math.txt",
            initial: ["sum(a,b)=a+b", ""].join("\n"),
          },
          {
            name: "usage.md",
            initial: ["# Usage", "", "sum(2,3)=5", ""].join("\n"),
          },
        ],
        prompt: ([mathPath, usagePath]) =>
          [
            `Target files: ${mathPath} and ${usagePath}.`,
            "Task: apply both file edits below:",
            'In "math.txt", add a new line: "multiply(a,b)=a*b".',
            'In "usage.md", append a line under usage examples: "multiply(2,3)=6".',
            "Use edit-file on both target paths and write the changes directly.",
            "Do not only read/search; complete both edits.",
            "Return a concise summary only.",
          ].join("\n"),
        validate: (contents) => {
          const values = Object.values(contents);
          return (
            values.some((content) => content.includes("multiply(a,b)=a*b")) &&
            values.some((content) => content.includes("multiply(2,3)=6"))
          );
        },
      });
      if (!multiFileTask.ok) {
        console.error(`✗ dogfood coding task multifile: ${multiFileTask.detail}`);
        process.exit(1);
        return;
      }
      console.log("✓ dogfood coding task multifile");

      const multiFileRefactorTask = await runMultiFileCodingTaskSmoke(smokeEnv, {
        id: "multifile-refactor",
        files: [
          {
            name: "types.ts",
            initial: ["export type User = {", "  id: string;", "  name: string;", "};", ""].join("\n"),
          },
          {
            name: "store.ts",
            initial: [
              'import type { User } from "./types";',
              "",
              "const users: User[] = [];",
              "",
              "export function findUserById(id: string): User | undefined {",
              "  return users.find((user) => user.id === id);",
              "}",
              "",
            ].join("\n"),
          },
          {
            name: "service.ts",
            initial: [
              'import { findUserById } from "./store";',
              "",
              "export function displayNameFor(id: string): string {",
              "  const user = findUserById(id);",
              '  return user ? user.name : "unknown";',
              "}",
              "",
            ].join("\n"),
          },
        ],
        prompt: ([typesPath, storePath, servicePath]) =>
          [
            `Target files: ${typesPath}, ${storePath}, and ${servicePath}.`,
            "Task: apply all edits below directly:",
            '1) In "types.ts", rename field "name" to "displayName".',
            '2) In "store.ts", rename function "findUserById" to "getUserById".',
            '3) In "service.ts", update import/call to "getUserById" and return "user.displayName".',
            "Use edit-file on target paths and complete all edits.",
            "Return a concise summary only.",
          ].join("\n"),
        validate: (contents) => {
          const values = Object.values(contents);
          const hasDisplayName = values.some((content) => content.includes("displayName"));
          const renamedStoreFn = values.some((content) => content.includes("getUserById"));
          const noOldStoreFn = values.every((content) => !content.includes("findUserById"));
          const noOldNameField = values.every((content) => !content.includes("user.name"));
          return hasDisplayName && renamedStoreFn && noOldStoreFn && noOldNameField;
        },
      });
      if (!multiFileRefactorTask.ok) {
        console.error(`✗ dogfood coding task multifile refactor: ${multiFileRefactorTask.detail}`);
        process.exit(1);
        return;
      }
      console.log("✓ dogfood coding task multifile refactor");
    } else {
      if (args.requireProviderReady) {
        console.error("✗ provider-ready: strict autonomy smoke requires configured provider credentials");
        process.exit(1);
        return;
      }
      console.log("○ dogfood coding tasks skipped (provider not ready)");
    }

    console.log("Dogfood smoke checks passed.");
  } finally {
    const smokeHome = smokeEnv.HOME;
    if (smokeHome) {
      await rm(smokeHome, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) {
  void main();
}
