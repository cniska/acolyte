# Localization

Acolyte keeps user-facing copy translatable while protocol methods, payload keys, tool ids, and machine-readable values remain stable.

## Translatable surfaces

- CLI/TUI help and guidance text
- human-readable status/error copy shown to users
- narrative assistant framing that is not part of machine contracts

## Language-neutral surfaces

- RPC method names and protocol message type identifiers
- structured payload keys and machine-readable enums
- tool ids, tool row labels, and machine markers in raw tool output
- file/line/path metadata emitted for automation and parsing
- prompt text sent to the model, which stays English so model behavior does not vary by locale
- key chords and the glyphs that stand for them, which name what the keyboard prints

A new protocol or tool contract takes an identifier-style name rather than a natural-language label, so translating a surface never changes a contract.

## Authoring

Messages are authored in ARB (`src/i18n/<locale>.arb`) and compiled into TypeScript by `bun run messages`. Nothing reads ARB at runtime.

Each message carries an `@<key>` entry describing where it appears and what its placeholders hold. Write that description as if for a translator who cannot see the code: name the surface, say whether a placeholder arrives already translated, and call out any literal that must survive translation, such as a command name, flag, or environment variable.

The compiler rejects a catalog that omits a key, adds an unknown one, uses a placeholder the English message does not, or leaves a description unwritten. It also rejects a key no source file references, so a message cannot be translated into every language after the code that showed it is gone.

A key held in a field rather than written at the call site is typed as a `PlainTranslationKey`, so a name no catalog carries is a compile error instead of a blank surface. Prose belongs in the message, never in the literal beside it: a chord rendered as `ctrl + c twice` keeps that “twice” in English in every language, while `ctrl + c` plus a translated “twice to exit” reads everywhere.

Call `t()` inside the function that renders, never at module scope. `setLocale` runs at the entrypoints (`cli.ts`, `server.ts`), so a string built while a module evaluates keeps the locale that happened to be active at import. A table of labels or help text is a thunk or a table of keys, resolved on read. Nothing enforces this — a frozen string is a half-translated screen, not an error — so a table that must hold rendered text is covered by a test that switches locale after import and asserts the new language.

## Selecting a language

`acolyte config set locale <id>` chooses the interface language, writing user scope so the choice follows the person across projects. The value is validated against the bundled locales, and a wrong one is answered with the full list. The language applies from the next launch.

## Message syntax

A message is literal text, `{name}` placeholders, and the ICU plural form `{count, plural, one {# file} other {# files}}`, where `#` is the count. Plural categories come from `Intl.PluralRules`, so a locale gets the arms its language actually needs; `other` is required and is used when a category has no arm.

A run of choices decided at runtime arrives as one placeholder, already joined by `Intl.ListFormat` in the active language, so the message never spells the conjunction itself. A fixed set small enough to write out belongs in the message text.

Other ICU forms — `select`, `selectordinal`, number and date skeletons — are not supported and fail the build. ICU quoting is not implemented either: an apostrophe touching `{`, `}`, or `#` is rejected, because a conforming ICU parser would read it as an escape and stop substituting.

## Adding a locale

1. Copy `src/i18n/en.arb` to `src/i18n/<locale>.arb` and translate the message values, leaving keys and placeholders as they are.
2. Run `bun run messages` and commit both the ARB file and the generated output.

The locale becomes selectable with no further wiring: the compiler discovers `*.arb`, and the generated catalog supplies both the `TRANSLATIONS` map and the locale enum the configuration validates against.

## Key naming

- put chat content under `chat.*` keys (slash-command responses, chat status rows, chat progress/error text)
- keep CLI-only command text under `cli.*` keys
- reserve `tui.*` for terminal UI chrome only (panel labels, key hints, picker/status-line framing), not chat content
- name a key for the surface it renders on, not the module that calls it
- prefer one stable key per message intent; two surfaces that show the same words keep separate keys when their wording may diverge
