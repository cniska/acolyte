# Known Issues

Tracked issues for post-OSS GitHub migration.

## Bugs

- **AI SDK stream errors surface as unhandled rejections**: When the AI SDK rejects during `agent.stream()` (e.g. invalid model ID, auth failure), the error escapes the generate loop's promise chain and hits the global unhandled rejection handler. The lifecycle then times out after 120s instead of failing fast. Root cause: the AI SDK rejects an internal promise that isn't part of the `fullStream` reader chain. See `lifecycle-generate.ts:206–242`.

## Limitations

- **Token budgeting uses approximate char-to-token ratios, not actual counts.** Token estimates in history pruning and budget calculations are heuristic. Actual token usage may differ significantly, especially for non-English text or code-heavy contexts.

- **Google provider has minimal test coverage.** Provider integration has manual validation for OpenAI and Anthropic; Google/Gemini coverage is limited.
