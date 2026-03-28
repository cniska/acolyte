import { resolve } from "node:path";
import { z } from "zod";
import { agentModeSchema } from "../src/agent-contract";
import { createInstructions } from "../src/agent-instructions";
import { loadSystemPrompt } from "../src/soul";

const showPromptArgsSchema = z.object({
  mode: agentModeSchema,
  workspace: z.string().min(1).optional(),
});

type ShowPromptArgs = z.infer<typeof showPromptArgsSchema>;

function parseArgs(args: string[]): ShowPromptArgs {
  let workspace: string | undefined;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--workspace") {
      workspace = args[index + 1];
      if (!workspace) throw new Error("--workspace requires a path");
      index += 1;
      continue;
    }
    if (arg?.startsWith("-")) throw new Error(`Unknown argument: ${arg}`);
    positional.push(arg);
  }
  const [mode] = positional;
  return showPromptArgsSchema.parse({ mode, workspace });
}

function printSection(title: string, body: string): void {
  if (!body.trim()) return;
  process.stdout.write(`## ${title}\n${body.trim()}\n\n`);
}

function showAgentPrompt(mode: "work" | "verify", workspace?: string): void {
  const cwd = workspace ? resolve(workspace) : process.cwd();
  const soulPrompt = loadSystemPrompt(cwd);
  printSection("System Prompt", createInstructions(soulPrompt, mode, workspace ? resolve(workspace) : undefined));
}

function main(argv: string[]): void {
  const args = parseArgs(argv);
  showAgentPrompt(args.mode, args.workspace);
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to show prompt";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

export { main, parseArgs };
