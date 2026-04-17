import { runCommand } from "./tool-utils";

const DEFAULT_ISSUE_LIMIT = 30;
const MAX_ISSUE_LIMIT = 100;

export type PrInfo = {
  number: number;
  state: string;
  title: string;
  url: string;
};

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
    const data = JSON.parse(stdout.trim());
    if (typeof data.number !== "number" || typeof data.state !== "string") return null;
    return { number: data.number, state: data.state, title: data.title ?? "", url: data.url ?? "" };
  } catch {
    return null;
  }
}

export type PrCreateInput = { title: string; body: string; base?: string };
export type PrCreateResult = { number: number; url: string };

export async function ghPrCreate(workspace: string, input: PrCreateInput): Promise<PrCreateResult> {
  const args = ["gh", "pr", "create", "--title", input.title, "--body", input.body];
  if (input.base) args.push("--base", input.base);
  const { code, stdout, stderr } = await runCommand(args, workspace);
  if (code !== 0) throw new Error(stderr.trim() || "gh pr create failed");
  const url = stdout.trim();
  const match = url.match(/\/pull\/(\d+)$/);
  const number = match ? Number.parseInt(match[1], 10) : 0;
  return { number, url };
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

export type IssueInfo = { number: number; state: string; title: string };

export type IssueCreateInput = { title: string; body: string; labels?: string[] };
export type IssueCreateResult = { number: number; url: string };

export async function ghIssueCreate(workspace: string, input: IssueCreateInput): Promise<IssueCreateResult> {
  const args = ["gh", "issue", "create", "--title", input.title, "--body", input.body];
  for (const label of input.labels ?? []) args.push("--label", label);
  const { code, stdout, stderr } = await runCommand(args, workspace);
  if (code !== 0) throw new Error(stderr.trim() || "gh issue create failed");
  const url = stdout.trim();
  const match = url.match(/\/issues\/(\d+)$/);
  const number = match ? Number.parseInt(match[1], 10) : 0;
  return { number, url };
}

export async function ghIssueView(workspace: string, number: number): Promise<IssueInfo | null> {
  try {
    const { code, stdout } = await runCommand(
      ["gh", "issue", "view", String(number), "--json", "number,state,title"],
      workspace,
    );
    if (code !== 0) return null;
    const data = JSON.parse(stdout.trim());
    if (typeof data.number !== "number") return null;
    return { number: data.number, state: data.state ?? "", title: data.title ?? "" };
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
    const data = JSON.parse(stdout.trim());
    if (!Array.isArray(data)) return [];
    return data
      .filter((item: unknown) => typeof item === "object" && item !== null && "number" in item)
      .map((item: Record<string, unknown>) => ({
        number: item.number as number,
        state: (item.state as string) ?? "",
        title: (item.title as string) ?? "",
      }));
  } catch {
    return [];
  }
}
