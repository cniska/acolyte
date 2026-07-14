import type React from "react";
import { unreachable } from "./assert";
import { formatCompactNumber } from "./chat-format";
import type { PrInfo, PrState } from "./gh-contract";
import { t } from "./i18n";
import { palette } from "./palette";
import { Box, Text } from "./tui";

export type StatusLineState = {
  /** Repo name (git root basename), or the cwd basename outside a git repo. */
  repo: string;
  worktree: string | null;
  branch: string | null;
  dirty: boolean;
  ahead: number;
  behind: number;
  /** Model display name, without the effort suffix. */
  model: string;
  effort: string | null;
  inputTokens: number;
  outputTokens: number;
  pr: PrInfo | null;
  skills: readonly string[];
};
export function prColor(state: PrState): string {
  switch (state) {
    case "open":
      return "green";
    case "merged":
      return "magenta";
    case "closed":
      return "red";
    default:
      return unreachable(state);
  }
}

/** dirty (`*`) and ahead/behind (`↑n ↓n`), rendered dim beside the branch name. */
function branchSuffix({ dirty, ahead, behind }: Pick<StatusLineState, "dirty" | "ahead" | "behind">): string {
  let suffix = dirty ? "*" : "";
  if (ahead > 0) suffix += ` ↑${ahead}`;
  if (behind > 0) suffix += ` ↓${behind}`;
  return suffix;
}

/**
 * Session token totals for the status line: committed per-turn usage plus the
 * in-flight `runningUsage` so the counts climb live during a turn. The message
 * handler clears `runningUsage` in the same synchronous batch that commits the
 * finished turn's entry, so no render double-counts a turn (chat-message-handler.ts).
 */
export function statusTokenTotals(
  committed: readonly { usage: { inputTokens: number; outputTokens: number } }[],
  running: { inputTokens: number; outputTokens: number } | null,
): { inputTokens: number; outputTokens: number } {
  let inputTokens = running?.inputTokens ?? 0;
  let outputTokens = running?.outputTokens ?? 0;
  for (const entry of committed) {
    inputTokens += entry.usage.inputTokens;
    outputTokens += entry.usage.outputTokens;
  }
  return { inputTokens, outputTokens };
}

export function StatusLine(state: StatusLineState): React.ReactNode {
  const { repo, worktree, branch, model, effort, inputTokens, outputTokens, pr, skills } = state;
  const segments: React.ReactNode[] = [];

  // Location: repo · worktree · branch, folded left to right (a name already shown
  // drops — a worktree usually shares its branch's name). The dirty/ahead-behind
  // suffix rides whichever shown name is the branch.
  const locationNames: string[] = [];
  for (const name of [repo, worktree, branch]) {
    if (name && !locationNames.includes(name)) locationNames.push(name);
  }
  const suffix = branchSuffix(state);
  for (const name of locationNames) {
    segments.push(
      <Text>
        <Text color={palette.gray}>{name}</Text>
        {name === branch && suffix ? <Text color={palette.dim}>{suffix}</Text> : null}
      </Text>,
    );
  }

  segments.push(
    <Text>
      <Text color={palette.gray}>{model}</Text>
      {effort ? <Text color={palette.dim}>{` ${effort}`}</Text> : null}
    </Text>,
  );

  if (inputTokens > 0 || outputTokens > 0) {
    segments.push(
      <Text color={palette.dim}>
        {t("unit.token.arrows", { input: formatCompactNumber(inputTokens), output: formatCompactNumber(outputTokens) })}
      </Text>,
    );
  }

  if (pr) {
    segments.push(
      <Text>
        <Text color={palette.dim}>PR </Text>
        <Text color={prColor(pr.state)}>#{pr.number}</Text>
      </Text>,
    );
  }

  const left = (
    <Text>
      {"  "}
      {segments.map((segment, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static positional segment list
        <Text key={index}>
          {index > 0 ? <Text color={palette.dim}>{" · "}</Text> : null}
          {segment}
        </Text>
      ))}
    </Text>
  );

  const skillSegment = skills.length > 0 ? skills.join(" · ") : null;
  if (!skillSegment) return left;

  return (
    <Box justifyContent="space-between" width="terminal">
      {left}
      {/* leading space keeps a separator when a narrow width floors the space-between gap to 0 */}
      <Text color={palette.dim}>{` ${skillSegment}`}</Text>
    </Box>
  );
}
