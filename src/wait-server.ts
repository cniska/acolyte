import { z } from "zod";

const DEFAULT_URL = "http://localhost:6767/healthz";
const DEFAULT_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 200;

type Args = {
  url: string;
  timeoutMs: number;
};

const argsSchema = z.object({
  url: z.string().min(1),
  timeoutMs: z.coerce.number().int().positive(),
});

function parseArgs(argv: string[]): Args {
  const raw: { url: string; timeoutMs: number | string } = {
    url: DEFAULT_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--url") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --url");
      }
      raw.url = value;
      i += 1;
      continue;
    }
    if (token === "--timeout-ms") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --timeout-ms");
      }
      raw.timeoutMs = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  const parsed = argsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid value for --timeout-ms");
  }
  return parsed.data;
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await waitForServer(args.url, args.timeoutMs);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Failed to wait for server");
    process.exit(1);
  });
}

export { parseArgs, waitForServer };
