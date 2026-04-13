# TUI Renderer

Custom React reconciler for terminal rendering. Replaces Ink with a minimal, zero-dependency renderer tailored to Acolyte's needs.

## Why custom

Ink is general-purpose and brings layout complexity (Yoga), dep weight, and behaviors we don't need. The custom renderer keeps the React component model but owns the full rendering pipeline — from tree reconciliation to terminal escape sequences.

## Primitives

Three components, intentionally minimal:

- **`Box`** — flex container. Props: `flexDirection`, `justifyContent`, `flexWrap`, `width`.
- **`Text`** — styled text span. Props: `color`, `dimColor`, `backgroundColor`, `bold`, `underline`, `inverse`.
- **`Static`** — write-once scrollback region. Rendered items are flushed to terminal scrollback and never re-rendered.

Hooks:

- **`useApp()`** — access `{ exit }` to terminate the app.
- **`useInput(handler, { isActive })`** — register a keyboard input handler.

## Rendering pipeline

```text
React tree → reconciler → TUI DOM → serialize → terminal output
```

- **reconciler:** React's `react-reconciler` drives updates against a TUI DOM tree
- **TUI DOM:** lightweight node tree (`tui-root`, `tui-box`, `tui-text`, `tui-static`, `tui-virtual`, text nodes)
- **serialize:** walks the DOM, resolves flex layout, applies ANSI styles, produces a string. `serializeSplit` separates static (scrollback) from active (re-rendered) regions
- **render loop:** on each React commit: serialize, diff against last output, erase and rewrite the active region. Static items flush once to scrollback. When the active region overflows the viewport, top lines are frozen to scrollback and only the bottom portion is re-rendered (see [Frozen Overflow](glossary.md)). Erase and repaint are atomic within a single DEC 2026 synchronized output block to prevent flicker
- **resize:** a debounced resize listener resets frozen overflow state and triggers a re-render with updated dimensions
- **focus repair:** on terminal focus-in (tab switch), frozen overflow state is invalidated and the active region is repainted via the normal commit path
- **DEC 2026:** synchronized output (BSU/ESU) wraps all terminal writes to prevent partial-frame rendering. Skipped in tmux where DEC 2026 is not supported

## Input handling

Centralized in `input.ts`. Raw stdin bytes are parsed into `KeyEvent` objects with named flags (`return`, `tab`, `ctrl`, `meta`, `escape`, arrows, etc.). Supports the [Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) for unambiguous modifier reporting, enabled only on terminals with full support (kitty, WezTerm, ghostty, iTerm). The dispatcher fans out to all registered handlers via `InputContext`.

Components register handlers through `useInput`. Only handlers with `isActive: true` receive events.

## Chat commands

- `/new`: start new session
- `/clear`: clear transcript
- `/resume`: resume a previous session
- `/sessions`: show sessions
- `/workspaces`: manage parallel workspaces (feature-flagged)
- `/model [id]`: change model
- `/status`: show server status
- `/usage`: show token usage
- `/memory [all|user|project]`: show memory notes
- `/memory add [--user|--project] <text>`: save memory note
- `/memory rm <id-prefix>`: remove memory note
- `/skill <name>`: run a skill command
- `/skills`: show skills picker
- `/exit`: exit chat

## File attachments

Use `@path` in chat input to attach file or directory context:

```
@src/cli.ts refactor the help text
@docs/ summarize the documentation
```

## Design constraints

- **Minimal primitive set.** Every new prop becomes renderer debt. Add only what's needed.
- **Layout rules are a product contract.** Add tests before adding layout semantics.
- **No "Ink, but homegrown."** If a feature doesn't materially help Acolyte's UX, don't add it.
- **Centralized input handling.** Terminal key parsing gets fragile fast — keep it in one place.
- **Terminal edge cases.** Wide glyphs, combining characters, ANSI length vs display width all need care. `stripAnsiLength` and `padLine` in `serialize.ts` handle width calculations.

## Testing

- **`renderToString`** (`render-to-string.ts`) — renders a React tree to a plain string without terminal side effects
- **`renderPlain`** (`src/tui-test-utils.ts`) — wraps `renderToString` with configurable terminal width for test convenience
- **`serialize.test.tsx`** — layout and serialization tests against the DOM tree directly

## Extension seams

- add primitives by extending `TuiNodeType` in `dom.ts` and handling them in `serialize.ts`
- add style props by extending `TuiProps` in `dom.ts` and `StyleStack` in `serialize.ts`
- keep the primitive surface small — prefer composing existing primitives over adding new ones

## Key files

- `src/tui/index.ts` — Public API surface.
- `src/tui/components.tsx` — `Box`, `Text`, `Static` primitives.
- `src/tui/dom.ts` — TUI DOM node types.
- `src/tui/serialize.ts` — Tree-to-string serialization with static/active split.
- `src/tui/render.ts` — Terminal render loop, raw mode, cursor management.
- `src/tui/input.ts` — Raw stdin dispatcher.
- `src/tui/context.ts` — `AppContext`, `InputContext`, `KeyEvent`.
- `src/tui/hooks.ts` — `useApp`, `useInput`.
- `src/tui/host-config.ts` — React reconciler host config.
- `src/tui/styles.ts` — ANSI escape sequences, color mapping.
- `src/tui/reconciler.ts` — React reconciler instance.

## Further reading

[No More Ink](https://crisu.me/blog/no-more-ink) — The story behind the TUI design.
