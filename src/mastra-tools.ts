import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { readSnippet, searchRepo } from "./coding-tools";

export const searchRepoTool = createTool({
  id: "search-repo",
  description: "Search the repository for a text pattern using ripgrep.",
  inputSchema: z.object({
    pattern: z.string().min(1),
    maxResults: z.number().int().min(1).max(200).optional(),
  }),
  execute: async (input) => {
    const maxResults = input.maxResults ?? 40;
    const result = await searchRepo(input.pattern, maxResults);
    return { result };
  },
});

export const readFileSnippetTool = createTool({
  id: "read-file-snippet",
  description: "Read a text file snippet by line range from the local repository.",
  inputSchema: z.object({
    path: z.string().min(1),
    start: z.number().int().min(1).optional(),
    end: z.number().int().min(1).optional(),
  }),
  execute: async (input) => {
    const start = input.start ? String(input.start) : undefined;
    const end = input.end ? String(input.end) : undefined;
    const result = await readSnippet(input.path, start, end);
    return { result };
  },
});

export const acolyteTools = {
  searchRepo: searchRepoTool,
  readFileSnippet: readFileSnippetTool,
};
