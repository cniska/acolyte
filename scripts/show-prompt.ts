#!/usr/bin/env bun
/**
 * Prints the full system prompt that would be sent to the model.
 *
 * Usage:
 *   bun scripts/show-prompt.ts [workspace]
 */
import { createInstructions } from "../src/agent-instructions";
import { loadSystemPrompt } from "../src/soul";

const workspace = process.argv[2] ?? process.cwd();
const soulPrompt = loadSystemPrompt();
const full = createInstructions(soulPrompt, workspace);

console.log(full);
