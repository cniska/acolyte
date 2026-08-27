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

## Pacing

Content is revealed at the display's own pace, not the provider's, in the unit a reader takes it in: prose by the whole word, a tool's output by the row. The pace is constant, so a smooth stream, a rate-limited one arriving in bursts, and a provider with no streaming at all read alike.

| Content | Unit | Pace |
|---|---|---|
| Prose | a whole word, never a fragment of one | eight characters per frame, extended to where the word ends |
| A mutation's rows — a diff, a new file | one row | one row per frame |
| Everything else a tool prints | — | not paced: shown as it arrives |

A frame is the renderer's paint throttle, so one row per frame is the fastest anything can appear. A mutation goes at that limit: visibly line by line, well past reading pace. Nothing else is paced — a running command's rows already appeared as the process printed them, and every other tool knows its output in full when it returns, so animating either would invent an arrival that never happened.

A mutation is neither trimmed nor bounded, so its reveal takes as long as it has rows, and a row opening after it waits: a very large write holds the transcript back for the length of its own reveal.

More content than the pace can clear takes proportionally longer; nothing switches law or rate to catch up. A tail with no word boundary in reach is held only while deltas are still arriving — the next one may carry the word's end; a tick that sees none reveals the remainder, and a block's end reveals it at once. Otherwise the reveal is bounded only where correctness requires it:

- **Presentation only** — the same parts, in the same order; pacing never adds or reshapes what a tool sent, and the model receives the full result whatever the transcript keeps.
- **The first part places the row** — it renders on arrival, so prose that arrives later cannot be committed above output that happened before it.
- **A row stays live until its output is revealed** — only a finalized section can be promoted, and a promoted row can no longer gain the lines it has not shown.
- **Ending the turn reveals the rest at once** — a cancelled or finished turn leaves nothing hidden.
- **A row opening below reveals the rest first** — content committed under a row that then grew would be pushed down the screen.
- **Only a mutation is paced** — a running command's rows appeared as they happened, and every other tool's output is known in full when it returns, so animating either invents an arrival. A stream surface cannot take back a printed line, so it receives everything at once.

## What a call keeps

What a call reveals is what it keeps. No row is trimmed or taken back once it has been shown, so a row's content is final the moment it appears and the transcript records what the reader watched arrive.

A mutation is the one thing the transcript is the only record of: the workspace holds the state a change produced, never the change itself, and the next edit to the same file takes even that away. So nothing a write or an edit shows is ever left out — an edit's whole diff, and every line of a new file.

A new file is shown as its content: numbered and syntax-highlighted, in the same shape a change's lines take, but with the marker column blank and no band behind it — nothing about it changed. Its lines are kept verbatim, because indentation and blank lines are the content.

Everything else is bounded to a window of rows under its header, a larger result stating how many lines it left out. Which end survives follows how the output is read: a listing, a log, or a diff you asked for keeps its first rows, and a command — read for how it ended — keeps its last.

- **The outcome lands with the result** — the marker takes its outcome color the moment the call ends, while the output it holds is still on screen.
- **A call the turn ends without a result is cancelled** — an interrupted call keeps whatever it showed, marked; a row still reading as live would hold every row after it out of scrollback for the rest of the session.
- **A row is held until its output is on screen** — a call marked done while rows are still arriving stays out of scrollback until the last of them lands, or it would freeze without them.
- **A diff's reveal is not cut short** — work that would open a row waits for it, so the transcript can trail the model; output skimmed for its tail is still cut short.
- **The header carries its own summary** — a match count, the line range a read served, a diff's added and removed counts — trailing the header text after a dimmed middot. A count of zero is not shown.
- **A header refines in place** — a tool that learns what its header says by doing the work replaces it, so the row placed on arrival is the row that stays.
- **A stream surface keeps everything** — it cannot revise a printed row, so nothing there is windowed.

## Layout ownership

- **One owner** — layout owns display-cell measurement, grapheme-safe wrapping, gutters, markers, borders, fills, ellipsis, diff line numbers, and cursor coordinates.
- **Composer rows** — `prompt-display` wraps the typed prompt into rows that tile the text and fit the box interior in display cells, and maps a cursor offset to a row and column. Layout renders those rows and the input handler moves through them; neither re-derives the wrapping.
- **Sent messages carry the composer frame** — a message to the agent renders inside the same rounded box the composer draws, so it keeps the shape it had while it was typed. A control command, which never reaches the model, echoes on a marker line instead.
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

- `src/chat-viewport-contract.ts` — the published input and derived presentation contracts.
- `src/chat-viewport-presentation.ts` — the *present* stage: derives semantics from published state.
- `src/terminal-chat-layout.ts` — the single geometry owner: presentation into a terminal scene.
- `src/terminal-theme.ts` — the fixed style-role table.
- `src/terminal-scene-contract.ts` — the scene: styled lines, cursor, sections, finalization.
- `src/input-controller.ts` — logical text and cursor editing without terminal layout.
- `src/tui/terminal-scene-viewport.tsx` — the shared scene-line renderer for live tail and frozen slices.
- `src/tui/scene-viewport.ts` — fitting, finalization eligibility, and promotion planning.

## Further reading

- [TUI](./tui.md) — the custom terminal renderer this pipeline prints through.
- [Beyond the Prompt](https://crisu.me/blog/beyond-the-prompt) — the design story behind the lifecycle and presentation split.
