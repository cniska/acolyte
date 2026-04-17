import { z } from "zod";
import {
  ghIssueCreate,
  ghIssueList,
  ghPrCreate,
  ghPrEdit,
  ghPrView,
  type IssueCreateInput,
  type PrCreateInput,
  type PrEditInput,
} from "./gh-ops";
import type { ToolkitInput } from "./tool-contract";
import { createTool } from "./tool-contract";
import { runTool } from "./tool-execution";

function createGhPrViewTool(input: ToolkitInput) {
  return createTool({
    id: "gh-pr-view",
    toolkit: "gh",
    category: "search",
    description: "View the pull request associated with the current branch.",
    instruction: "Use `gh-pr-view` to check PR status before creating or editing.",
    inputSchema: z.object({}).optional(),
    outputSchema: z.object({
      kind: z.literal("gh-pr-view"),
      pr: z
        .object({
          number: z.number().int(),
          state: z.string(),
          title: z.string(),
          url: z.string(),
        })
        .nullable(),
    }),
    execute: async (_toolInput, toolCallId) => {
      return runTool(input.session, "gh-pr-view", toolCallId, {}, async (callId) => {
        const pr = await ghPrView(input.workspace);
        const detail = pr ? `#${pr.number} (${pr.state})` : "no PR";
        input.onOutput({
          toolName: "gh-pr-view",
          content: { kind: "tool-header", labelKey: "tool.label.gh_pr_view", detail },
          toolCallId: callId,
        });
        return { kind: "gh-pr-view" as const, pr };
      });
    },
  });
}

function createGhPrCreateTool(input: ToolkitInput) {
  return createTool({
    id: "gh-pr-create",
    toolkit: "gh",
    category: "write",
    description: "Create a pull request for the current branch.",
    instruction: "Use `gh-pr-create` after pushing the branch. Requires title and body.",
    inputSchema: z.object({
      title: z.string().min(1),
      body: z.string().min(1),
      base: z.string().optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("gh-pr-create"),
      number: z.number().int(),
      url: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      const createInput: PrCreateInput = { title: toolInput.title, body: toolInput.body, base: toolInput.base };
      return runTool(input.session, "gh-pr-create", toolCallId, toolInput, async (callId) => {
        const result = await ghPrCreate(input.workspace, createInput);
        input.onOutput({
          toolName: "gh-pr-create",
          content: { kind: "tool-header", labelKey: "tool.label.gh_pr_create", detail: `#${result.number}` },
          toolCallId: callId,
        });
        return { kind: "gh-pr-create" as const, ...result };
      });
    },
  });
}

function createGhPrEditTool(input: ToolkitInput) {
  return createTool({
    id: "gh-pr-edit",
    toolkit: "gh",
    category: "write",
    description: "Edit the title or body of an existing pull request.",
    instruction: "Use `gh-pr-edit` to update PR title or body. Requires PR number.",
    inputSchema: z.object({
      number: z.number().int(),
      title: z.string().min(1).optional(),
      body: z.string().min(1).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("gh-pr-edit"),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      const editInput: PrEditInput = { number: toolInput.number, title: toolInput.title, body: toolInput.body };
      return runTool(input.session, "gh-pr-edit", toolCallId, toolInput, async (callId) => {
        const output = await ghPrEdit(input.workspace, editInput);
        input.onOutput({
          toolName: "gh-pr-edit",
          content: { kind: "tool-header", labelKey: "tool.label.gh_pr_edit", detail: `#${toolInput.number}` },
          toolCallId: callId,
        });
        return { kind: "gh-pr-edit" as const, output };
      });
    },
  });
}

function createGhIssueCreateTool(input: ToolkitInput) {
  return createTool({
    id: "gh-issue-create",
    toolkit: "gh",
    category: "write",
    description: "Create a GitHub issue.",
    instruction: "Use `gh-issue-create` to file bugs or feature requests. Requires title and body.",
    inputSchema: z.object({
      title: z.string().min(1),
      body: z.string().min(1),
      labels: z.array(z.string().min(1)).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("gh-issue-create"),
      number: z.number().int(),
      url: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      const createInput: IssueCreateInput = {
        title: toolInput.title,
        body: toolInput.body,
        labels: toolInput.labels,
      };
      return runTool(input.session, "gh-issue-create", toolCallId, toolInput, async (callId) => {
        const result = await ghIssueCreate(input.workspace, createInput);
        input.onOutput({
          toolName: "gh-issue-create",
          content: { kind: "tool-header", labelKey: "tool.label.gh_issue_create", detail: `#${result.number}` },
          toolCallId: callId,
        });
        return { kind: "gh-issue-create" as const, ...result };
      });
    },
  });
}

function createGhIssueListTool(input: ToolkitInput) {
  return createTool({
    id: "gh-issue-list",
    toolkit: "gh",
    category: "search",
    description: "List GitHub issues for the current repository.",
    instruction: "Use `gh-issue-list` to check for duplicates before creating issues.",
    inputSchema: z.object({
      state: z.enum(["open", "closed", "all"]).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("gh-issue-list"),
      issues: z.array(
        z.object({
          number: z.number().int(),
          state: z.string(),
          title: z.string(),
        }),
      ),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "gh-issue-list", toolCallId, toolInput, async (callId) => {
        const issues = await ghIssueList(input.workspace, {
          state: toolInput.state,
          limit: toolInput.limit,
        });
        input.onOutput({
          toolName: "gh-issue-list",
          content: { kind: "tool-header", labelKey: "tool.label.gh_issue_list", detail: `${issues.length} issues` },
          toolCallId: callId,
        });
        return { kind: "gh-issue-list" as const, issues };
      });
    },
  });
}

export function createGhToolkit(input: ToolkitInput) {
  return {
    ghPrView: createGhPrViewTool(input),
    ghPrCreate: createGhPrCreateTool(input),
    ghPrEdit: createGhPrEditTool(input),
    ghIssueCreate: createGhIssueCreateTool(input),
    ghIssueList: createGhIssueListTool(input),
  };
}
