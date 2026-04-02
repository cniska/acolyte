import type { LanguageModelV3, SharedV3ProviderOptions } from "@ai-sdk/provider";
import type { GenerateResult, StreamChunk } from "./lifecycle-contract";
import type { ToolDefinition } from "./tool-contract";

export type Agent = {
  readonly id: string;
  readonly name: string;
  readonly instructions: string | (() => string | Promise<string>);
  readonly model: LanguageModelV3;
  readonly tools: Record<string, ToolDefinition>;
  stream(prompt: string, options: StreamOptions): Promise<StreamOutput>;
};

export type StreamOptions = {
  toolChoice?: "auto" | "none" | "required";
  temperature?: number;
  providerOptions?: SharedV3ProviderOptions;
  /** Max nudge re-prompts when the model stops prematurely. 0 disables. */
  maxNudges?: number;
};

export type StreamOutput = {
  fullStream: ReadableStream<StreamChunk>;
  getFullOutput(): Promise<GenerateResult>;
};
