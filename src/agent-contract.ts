import type { LanguageModelV3, LanguageModelV3Message, SharedV3ProviderOptions } from "@ai-sdk/provider";
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
  preCallInputTokenLimit?: number;
  onBeforeNextCall?: (messages: readonly LanguageModelV3Message[]) => LanguageModelV3Message[];
};

export type StreamOutput = {
  fullStream: ReadableStream<StreamChunk>;
  getFullOutput(): Promise<GenerateResult>;
};
