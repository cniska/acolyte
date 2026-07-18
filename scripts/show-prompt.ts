#!/usr/bin/env bun
/**
 * Prints the full system prompt that would be sent to the model.
 *
 * Usage:
 *   bun scripts/show-prompt.ts [workspace]
 */
import { createInstructions } from "../src/agent-instructions";
import { loadSoulPrompt } from "../src/soul";

const workspace = process.argv[2] ?? process.cwd();
const soulPrompt = loadSoulPrompt();
const full = createInstructions(soulPrompt, workspace);

console.log(full);
