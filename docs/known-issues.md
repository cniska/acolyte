# Known Issues

## Bugs

- **AI SDK stream errors surface as unhandled rejections**: When the AI SDK rejects during `agent.stream()` (e.g. invalid model ID, auth failure), the error escapes the generate loop's promise chain and hits the global unhandled rejection handler. The lifecycle then times out after 120s instead of failing fast. Root cause: the AI SDK rejects an internal promise that isn't part of the `fullStream` reader chain.

- **Ink repaint breaks scrollback**: Ink's repaint snaps the viewport to the bottom on every render cycle. Scrolling only works to the very top or very bottom — intermediate positions are immediately lost.

- **Tab switching duplicates header**: Switching terminal tabs or windows causes Ink to re-render on top of stale terminal state, duplicating the header and other top-of-screen content.

- **Ink incremental rendering causes input duplication**: Enabling `incrementalRendering: true` causes the input prompt to duplicate on every repaint. The line-level diff doesn't handle the frequently-updating input line correctly. Reverted; standard rendering is the only viable mode for now.

## Limitations

- **Google provider has minimal test coverage.** Provider integration has manual validation for OpenAI and Anthropic; Google/Gemini coverage is limited.
