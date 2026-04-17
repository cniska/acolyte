import { runCommand } from "./tool-utils";

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
    const { code, stdout } = await runCommand(
      ["gh", "pr", "view", "--json", "number,state,title,url"],
      workspace,
    );
    if (code !== 0) return null;
    const data = JSON.parse(stdout.trim());
    if (typeof data.number !== "number" || typeof data.state !== "string") return null;
    return { number: data.number, state: data.state, title: data.title ?? "", url: data.url ?? "" };
  } catch {
    return null;
  }
}
