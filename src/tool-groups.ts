import { toolIdsByCategory } from "./tool-registry";

export const WRITE_TOOLS: readonly string[] = toolIdsByCategory("write");
export const READ_TOOLS: readonly string[] = toolIdsByCategory("read");
export const SEARCH_TOOLS: readonly string[] = toolIdsByCategory("search");
export const DISCOVERY_TOOLS: readonly string[] = [...READ_TOOLS, ...SEARCH_TOOLS].sort();

export const WRITE_TOOL_SET = new Set<string>(WRITE_TOOLS);
export const READ_TOOL_SET = new Set<string>(READ_TOOLS);
export const SEARCH_TOOL_SET = new Set<string>(SEARCH_TOOLS);
export const DISCOVERY_TOOL_SET = new Set<string>(DISCOVERY_TOOLS);
