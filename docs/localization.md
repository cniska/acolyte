# Localization

Acolyte keeps user-facing copy translatable while protocol methods, payload keys, tool IDs, and machine-readable values remain stable.

## Goal

Keep user-facing copy translatable while keeping protocol and tool contracts language-neutral and stable.

## Translatable surfaces

- CLI/TUI help and guidance text
- human-readable status/error copy shown to users
- narrative assistant framing that is not part of machine contracts

## Language-neutral surfaces

- RPC method names and protocol message type identifiers
- structured payload keys and machine-readable enums
- tool ids and machine markers in raw tool output
- file/line/path metadata emitted for automation and parsing
- prompt text sent to the model, which stays English so model behavior does not vary by locale

## Baseline policy

- new protocol/tool contracts must use stable identifier-style names (not natural-language labels)
- user-facing copy should stay in presentation layers so translation can be added without changing protocol/tool contracts

## Authoring

Messages are authored in ARB (`src/i18n/<locale>.arb`) and compiled into TypeScript by `bun run messages`. Nothing reads ARB at runtime.

Each message carries an `@<key>` entry describing where it appears and what its placeholders hold. Write that description as if for a translator who cannot see the code: name the surface, say whether a placeholder arrives already translated, and call out any literal that must survive translation, such as a command name, flag, or environment variable.

The compiler rejects a catalog that omits a key, adds an unknown one, uses a placeholder the English message does not, or leaves a description unwritten.

## Message syntax

A message is literal text, `{name}` placeholders, and the ICU plural form `{count, plural, one {# file} other {# files}}`, where `#` is the count. Plural categories come from `Intl.PluralRules`, so a locale gets the arms its language actually needs; `other` is required and is used when a category has no arm.

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
