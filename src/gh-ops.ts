import {
  type CreateResult,
  createResultSchema,
  type IssueInfo,
  issueInfoSchema,
  issueListSchema,
  type PrInfo,
  prInfoSchema,
} from "./gh-contract";
import { runCommand } from "./tool-utils";

const DEFAULT_ISSUE_LIMIT = 30;
const MAX_ISSUE_LIMIT = 100;

let ghInstalledCache: boolean | undefined;

export function ghInstalled(): boolean {
  if (ghInstalledCache !== undefined) return ghInstalledCache;
  try {
    const result = Bun.spawnSync({ cmd: ["gh", "--version"], stdout: "pipe", stderr: "pipe" });
    ghInstalledCache = result.exitCode === 0;
  } catch {
    ghInstalledCache = false;
  }
  return ghInstalledCache;
}

export async function ghAvailable(workspace: string): Promise<boolean> {
  try {
    const { code } = await runCommand(["gh", "auth", "status"], workspace);
    return code === 0;
  } catch {
    return false;
  }
}

export async function ghPrView(workspace: string): Promise<PrInfo | null> {
  try {
    const { code, stdout } = await runCommand(["gh", "pr", "view", "--json", "number,state,title,url"], workspace);
    if (code !== 0) return null;
    return prInfoSchema.parse(JSON.parse(stdout.trim()));
  } catch {
    return null;
  }
}

export type PrCreateInput = { title: string; body: string; base?: string };

export async function ghPrCreate(workspace: string, input: PrCreateInput): Promise<CreateResult> {
  const args = ["gh", "pr", "create", "--title", input.title, "--body", input.body];
  if (input.base) args.push("--base", input.base);
  const { code, stdout, stderr } = await runCommand(args, workspace);
  if (code !== 0) throw new Error(stderr.trim() || "gh pr create failed");
  const url = stdout.trim();
  const match = url.match(/\/pull\/(\d+)$/);
  const number = match ? Number.parseInt(match[1], 10) : 0;
  return createResultSchema.parse({ number, url });
}

export type PrEditInput = { number: number; title?: string; body?: string };

export async function ghPrEdit(workspace: string, input: PrEditInput): Promise<string> {
  const args = ["gh", "pr", "edit", String(input.number)];
  if (input.title) args.push("--title", input.title);
  if (input.body) args.push("--body", input.body);
  const { code, stdout, stderr } = await runCommand(args, workspace);
  if (code !== 0) throw new Error(stderr.trim() || "gh pr edit failed");
  return stdout.trim() || "updated";
}

export type IssueCreateInput = { title: string; body: string; labels?: string[] };

export async function ghIssueCreate(workspace: string, input: IssueCreateInput): Promise<CreateResult> {
  const args = ["gh", "issue", "create", "--title", input.title, "--body", input.body];
  for (const label of input.labels ?? []) args.push("--label", label);
  const { code, stdout, stderr } = await runCommand(args, workspace);
  if (code !== 0) throw new Error(stderr.trim() || "gh issue create failed");
  const url = stdout.trim();
  const match = url.match(/\/issues\/(\d+)$/);
  const number = match ? Number.parseInt(match[1], 10) : 0;
  return createResultSchema.parse({ number, url });
}

export async function ghIssueView(workspace: string, number: number): Promise<IssueInfo | null> {
  try {
    const { code, stdout } = await runCommand(
      ["gh", "issue", "view", String(number), "--json", "number,state,title"],
      workspace,
    );
    if (code !== 0) return null;
    return issueInfoSchema.parse(JSON.parse(stdout.trim()));
  } catch {
    return null;
  }
}

export async function ghIssueList(
  workspace: string,
  options?: { state?: string; limit?: number },
): Promise<IssueInfo[]> {
  const limit = Math.max(1, Math.min(MAX_ISSUE_LIMIT, options?.limit ?? DEFAULT_ISSUE_LIMIT));
  const args = ["gh", "issue", "list", "--json", "number,state,title", "--limit", String(limit)];
  if (options?.state) args.push("--state", options.state);
  try {
    const { code, stdout } = await runCommand(args, workspace);
    if (code !== 0) return [];
    return issueListSchema.parse(JSON.parse(stdout.trim()));
  } catch {
    return [];
  }
}
