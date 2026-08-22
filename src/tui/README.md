# TUI Renderer Modules

Map of the custom React terminal renderer's modules, for finding the file that owns a change. [docs/tui.md](../../docs/tui.md) states the renderer's behavior and contract; this page only says where each piece lives.

## Pipeline

React elements become terminal bytes in one direction, each stage owning its own step.

- `jsx.d.ts` — JSX intrinsic element types for the `tui-*` tags
- `components.tsx` — `Box`, `Text`, and `Static`, the elements a chat component composes
- `dom.ts` — the node tree those elements build, and the mutations the reconciler applies to it
- `host-config.ts` — the react-reconciler host config, plus the commit and clear hooks the render loop registers
- `reconciler.ts` — the react-reconciler instance bound to that host config
- `serialize.ts` — a node tree flattened to styled lines, split into committed scrollback and the active region
- `render.ts` — the render loop: frame commits, erase geometry, frozen scrollback, resize, and synchronized output

## Input

- `input.ts` — stdin bytes parsed into key events, and the dispatcher that fans them out to active handlers
- `context.ts` — the `KeyEvent` shape and the app and input React contexts
- `hooks.ts` — `useApp` and `useInput`, the surface a component registers through
- `effects.ts` — the approved effect helpers; chat-layer code uses these instead of `useEffect` directly

## Layout

- `scene-viewport.ts` — fitting a scene to the viewport and planning which slices promote to scrollback
- `terminal-scene-viewport.tsx` — the component that renders a fitted scene
- `styles.ts` — ANSI sequences, color conversion, and the kitty keyboard protocol
- `constants.ts` — fallback terminal dimensions for a non-TTY stdout

## Tests and harnesses

Each module's tests sit beside it as `<module>.test.ts`, with the frame-level suites in `render.test.tsx`. [docs/testing.md](../../docs/testing.md) covers how the suites are split and run.

- `vt.ts` — an in-repo virtual terminal that replays writes, used to assert transcript integrity
- `test-utils.ts` — frame splitting, cursor-accounting assertions, and hook-driving helpers the suites share
- `render-to-string.ts` — a tree rendered to a plain string, for snapshot comparisons

## Imports

The renderer is a self-contained package: `index.ts` is its public API, and code outside this directory imports through it rather than from a module inside. The rest of the repo imports canonical modules directly — the renderer is the exception, because a package boundary is what lets its module split change without touching callers.
