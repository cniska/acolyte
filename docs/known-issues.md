# Known Issues

## Bugs

- **AI SDK stream errors surface as unhandled rejections**: When the AI SDK rejects during `agent.stream()` (e.g. invalid model ID, auth failure), the error escapes the generate loop's promise chain and hits the global unhandled rejection handler. The lifecycle then times out after 120s instead of failing fast. Root cause: the AI SDK rejects an internal promise that isn't part of the `fullStream` reader chain.


## Limitations

- **Google provider has minimal test coverage.** Provider integration has manual validation for OpenAI and Anthropic; Google/Gemini coverage is limited.
