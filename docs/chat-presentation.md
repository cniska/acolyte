# Chat Presentation

Acolyte's chat is a one-directional pipeline that turns chat state into terminal text through stages that cannot reach back into each other.

Semantics never see pixels, terminal geometry has one owner, and the fixed theme owns colors. A visual redesign therefore changes layout and theme without altering agent behavior or corrupting the transcript. Interactive chat and CLI plain output consume the same layout.

## The stages

```text
publish → present → lay out → resolve → render
```

| Stage | Input and responsibility |
|---|---|
| **Publish** | Lossless chat state: messages, running state, composer text, and cursor. No colors or widths. |
| **Present** | Derived semantics: wording, hints, outcome labels, and identity. No pixels. |
| **Lay out** | Builds the terminal scene: wrapping, gutters, markers, borders, caret, and style roles. This is the only width-aware stage. |
| **Resolve** | Maps each style role through the fixed theme to a terminal-neutral style. |
| **Render** | Serializes styles to ANSI and prints. |

The `*Input` / `*Presentation` suffixes on the contracts encode the direction: raw published state (`ChatViewportPresentationInput`) flows into derived semantics (`ChatViewportPresentation`), never the reverse.

## Style roles and the theme

A **style role** names how text should look (`muted`, `cursor`, `diff-added`, `selected`); it is never a color. Layout selects from a finite role enum. The fixed terminal theme is the only place a role becomes foreground, background, bold, dim, or inverse.

- **Theme owns** colors and text attributes. There are no user themes, variants, or theme names.
- **Layout owns** wording, marker glyphs, gutters, widths, borders, and geometry.
- **Literal styles stay local** to the theme table so its rendered result is readable without chasing a palette layer. The shared brand color is the sole shared identity constant.

## Terminal scene

The scene is the physical output of *lay out*. It contains no React nodes.

| Scene element | Meaning |
|---|---|
| `lines` | Ordered styled lines, each made of `{text, role}` spans. |
| `cursor` | Optional row and column. |
| `sections` | `header`, one section per transcript row, optional `pending`, `composer`, and `footer`. |
| `fill` | Optional line-level background role. |

The scene is the only home for display-cell measurement, grapheme-safe wrapping, gutters, borders, background fill, and cursor geometry, apart from the composer's own row model below. A line fill paints from the first non-blank span to the row end, leaving leading indentation unpainted; diff bands can therefore span gutter, text, and trailing pad while span foregrounds remain independent.

A section is **finalized** only when its bytes can never change. Streaming prose, active tools, pending rows, and mutable geometry are never finalized.

## Promotion

```text
finalized section → immutable slice → terminal scrollback → removed from active scene
```

- **Commit once** — a promoted slice's physical lines are exactly what rendered live.
- **Keep the tail small** — promoted slices leave the active scene, so repainting only rebuilds active transcript content.
- **Promote sections, not lines** — resize changes line indices on rewrap; whole sections remain stable.
- **Resume semantically** — sessions persist transcript rows, not physical scenes. Resume re-lays them out under current constraints.

## Layout ownership

- **One owner** — layout owns display-cell measurement, grapheme-safe wrapping, gutters, markers, borders, fills, ellipsis, diff line numbers, and cursor coordinates.
- **Composer rows** — `prompt-display` wraps the typed prompt into rows that tile the text and fit the box interior in display cells, and maps a cursor offset to a row and column. Layout renders those rows and the input handler moves through them; neither re-derives the wrapping.
- **Local coordinates** — sub-layouts receive only a width budget and lay out from column zero. Composition alone applies physical insets and frames.
- **Shared tool layout** — CLI output and interactive chat consume the same tool layout, preserving ordering, headers, diff gutters, fitting, and truncation.
- **One truncation rule** — content exceeding any width budget, terminal-wide or nested, receives a trailing ellipsis through the grapheme-aware layout helper.

## Input ownership

- **Controller** — owns logical composer text and cursor through a geometry-free reducer: insert, delete, word motion, clear, and absolute cursor placement.
- **Layout** — resolves visual up/down motion to a logical offset before dispatch and is the sole owner of caret coordinates.
- **Scene** — draws the caret with the `cursor` role, so its column cannot disagree with rendered wrapping.

## Invariants

- **Semantic state** contains no React nodes, ANSI values, palette colors, glyphs, terminal widths, wrapped strings, or layout calculations.
- **Single geometry owner** — one module owns all display-cell measurement, wrapping, gutters, markers, borders, fill, ellipsis, composer geometry, and cursor coordinates.
- **Fixed theme boundary** — layout selects finite semantic style roles; the fixed internal theme resolves them to terminal-neutral styles; the renderer serializes styles to ANSI. This is not user-configurable theming.
- **Promotion integrity** — only immutable finalized sections enter scrollback, and their physical lines are exactly what rendered live; they are never mutated after commit.
- **No parallel presentation systems** — chat cannot keep React-owned geometry alongside scene-owned geometry for the same section.

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
