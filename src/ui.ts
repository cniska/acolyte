import { stdout } from "node:process";

const color = {
  dim: (value: string): string => `\x1b[2m${value}\x1b[22m`,
  cyan: (value: string): string => `\x1b[36m${value}\x1b[39m`,
  green: (value: string): string => `\x1b[32m${value}\x1b[39m`,
  yellow: (value: string): string => `\x1b[33m${value}\x1b[39m`,
  red: (value: string): string => `\x1b[31m${value}\x1b[39m`,
  bold: (value: string): string => `\x1b[1m${value}\x1b[22m`,
};

export function banner(model: string, sessionId: string): void {
  const border = "─".repeat(66);
  stdout.write(`${color.cyan(border)}\n`);
  stdout.write(`${color.bold("ACOLYTE")}${color.dim("  personal agentic CLI")}`);
  stdout.write(`  ${color.dim("model:")} ${model}  ${color.dim("session:")} ${sessionId.slice(0, 12)}\n`);
  stdout.write(`${color.cyan(border)}\n`);
  stdout.write(`${color.dim("Type /help for commands. Ctrl+C or /exit to quit.")}\n\n`);
}

export function printUser(content: string): void {
  stdout.write(`${color.green("you")}: ${content}\n`);
}

export function printAssistantHeader(): void {
  stdout.write(`${color.cyan("acolyte")}: `);
}

export async function streamText(content: string): Promise<void> {
  const words = content.split(" ");
  for (let i = 0; i < words.length; i += 1) {
    stdout.write(i === words.length - 1 ? `${words[i]}\n` : `${words[i]} `);
    await Bun.sleep(12);
  }
}

export function printInfo(content: string): void {
  stdout.write(`${color.dim(content)}\n`);
}

export function printWarning(content: string): void {
  stdout.write(`${color.yellow(content)}\n`);
}

export function printError(content: string): void {
  stdout.write(`${color.red(content)}\n`);
}
