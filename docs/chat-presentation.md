# Chat Presentation Pipeline

Acolyte's chat is a one-directional pipeline that turns chat state into terminal text through stages that cannot reach back into each other.

Semantics never see pixels, terminal geometry has a single owner, and a fixed theme is the only place colors live. A visual redesign is therefore a change to layout and theme that provably cannot alter agent behavior or corrupt the transcript, and the interactive chat and the CLI's plain output consume the same layout so the two cannot drift.

## The stages

```text
publish → present → lay out → resolve → render
```

- **publish**: a lossless snapshot of current chat state (messages, running state, composer text, cursor). No colors, no widths.
- **present**: the derived semantic view (wording, hints, outcome labels, identity). Still no pixels.
- **lay out**: turns the presentation into a terminal scene, wrapping text and placing gutters, markers, borders, and the caret, tagging each piece with a style role. The only stage that knows the terminal width.
- **resolve**: a fixed theme maps each style role to a terminal-neutral style.
- **render**: the renderer serializes styles to ANSI and prints.

The `*Input` / `*Presentation` suffixes on the contracts encode the direction: raw published state (`ChatViewportPresentationInput`) flows into derived semantics (`ChatViewportPresentation`), never the reverse.

## Style roles and the theme

A **style role** is a name for how a piece of text should look (`muted`, `cursor`, `diff-added`, `selected`), never a color. Layout may only pick from a finite enum of roles; the fixed terminal theme is the single place a role becomes a concrete style (foreground, background, bold, dim, inverse). There are no user themes, no light/dark variants, no theme names. One internal theme.

This is the seam that makes a facelift safe: it moves roles and their resolutions, nothing upstream. Marker glyphs, gutters, widths, borders, and wording are layout policy, not theme; the theme owns colors and text attributes only.

The theme states each role's literal style at the point of definition rather than referencing a shared palette layer: reading the theme tells you the actual style with no indirection to chase. The one exception is a genuinely shared identity constant (the brand color, used by several roles), which is honest single-sourcing rather than premature deduplication.

## Terminal scene

The scene is the physical output of *lay out*: an ordered list of styled `lines` (each a list of `{text, role}` spans), an optional `cursor` (row and column), ordered `sections`, and each line's optional `fill`. It is the only place display-cell measurement, grapheme-safe wrapping, gutters, borders, background fill, and cursor geometry live. It contains no React nodes.

A **line fill** is a line-level role whose background paints the row's content region (from the first non-blank span to the line end), leaving leading indentation unpainted. This is how a diff row gets a full-width background band spanning gutter, text, and trailing pad while the span foregrounds stay independent.

The scene is cut into identified **sections** (`header`, one per transcript row, an optional `pending` block, and `composer`; the footer folds into the composer section). A section is **finalized** when its bytes can never change again. Streaming prose, active tools, pending rows, and mutable geometry are never finalized.

## Promotion

Only finalized sections may enter static scrollback, and their physical lines must be exactly what rendered live. As finalized sections scroll past the live viewport they are frozen into immutable slices, committed once to the terminal's own scrollback, and evicted from the active scene, so the repainting live tail stays small and the scene is always built from the active transcript only.

The rejected alternative, a full-transcript scene with an advancing line-index boundary, is incoherent under resize, since line indices shift on rewrap. Freezing whole sections in section space survives a width change; a line boundary does not.

Sessions persist semantic transcript rows, not physical scenes. A resumed session re-lays-out its rows under the current terminal constraints, reproducing byte-exact output.

## Layout ownership

Terminal layout is the single geometry owner. It owns display-cell measurement, grapheme-safe wrapping, gutters, markers, borders, background fill, ellipsis, diff line-number layout, composer geometry, and cursor coordinates. Sub-layouts stay column-origin-free: they receive a width budget and lay out against their own column zero. The composition step is the only place that knows the physical column map, applying insets and frames there so the renderer and the shared tool-layout primitives never learn about chat chrome. This keeps CLI plain-output parity safe by construction: the CLI adapter and the interactive renderer consume the same semantic tool layout and must not diverge in tool ordering, headers, diff gutters, width fitting, or truncation.

Any element laid out into a width budget truncates with a trailing ellipsis when its content exceeds that budget, whether the budget is the full terminal width or a sub-column. This is layout policy expressed through one grapheme-aware helper.

## Input ownership

A renderer-independent input controller owns the composer's logical text and cursor, edited through a geometry-free reducer (insert, delete, word motion, clear, absolute set-cursor). Typing dispatches actions; layout resolves visual up/down motion to a logical offset before dispatch, so the reducer never sees widths. The scene draws the caret via the `cursor` role, and layout is the single source of the caret column so the caret and the rendered wrap cannot disagree.

## Invariants

- **Semantic state** contains no React nodes, ANSI values, palette colors, glyphs, terminal widths, wrapped strings, or layout calculations.
- **Single geometry owner:** one module owns all display-cell measurement, wrapping, gutters, markers, borders, fill, ellipsis, composer geometry, and cursor coordinates.
- **Fixed theme boundary:** layout selects finite semantic style roles; the fixed internal theme resolves them to terminal-neutral styles; the renderer serializes styles to ANSI. This is not user-configurable theming.
- **Promotion integrity:** only immutable finalized sections enter scrollback, and their physical lines are exactly what rendered live; they are never mutated after commit.
- **No parallel presentation systems:** chat cannot keep React-owned geometry alongside scene-owned geometry for the same section.

## Key files

- `chat-viewport-contract.ts` — the published input and derived presentation contracts.
- `chat-viewport-presentation.ts` — the *present* stage: derives semantics from published state.
- `terminal-chat-layout.ts` — the single geometry owner: presentation into a terminal scene.
- `terminal-theme.ts` — the fixed style-role table.
- `terminal-scene-contract.ts` — the scene: styled lines, cursor, sections, finalization.
- `input-controller.ts` — logical text and cursor editing without terminal layout.
- `tui/terminal-scene-viewport.tsx` — the shared scene-line renderer for live tail and frozen slices.
- `tui/scene-viewport.ts` — fitting, finalization eligibility, and promotion planning.

## Further reading

- [TUI](./tui.md) — the custom terminal renderer this pipeline prints through.
- [Beyond the Prompt](https://crisu.me/blog/beyond-the-prompt) — the design story behind the lifecycle and presentation split.
