# Localization

How Acolyte separates translatable user-facing copy from language-neutral protocol contracts.

## Goal

Keep user-facing copy translatable while keeping protocol and tool contracts language-neutral and stable.

## Translatable surfaces

- CLI/TUI help and guidance text.
- Human-readable status/error copy shown to users.
- Narrative assistant framing that is not part of machine contracts.

## Language-neutral surfaces

- RPC method names and protocol message type identifiers.
- Structured payload keys and machine-readable enums.
- Tool ids and machine markers in raw tool output.
- File/line/path metadata emitted for automation and parsing.

## Baseline policy

- New protocol/tool contracts must use stable identifier-style names (not natural-language labels).
- User-facing copy should stay in presentation layers so translation can be added without changing protocol/tool contracts.

## Current behavior

- Locale is configurable via config (`locale` key, for example `acolyte config set locale en`).
- Locale files are discovered automatically from `src/i18n/locales/*.json`.
- Adding a new locale requires only adding one JSON file named `<locale>.json` with a complete catalog.
- Locale tags use BCP-47 style with `-` separators (for example `en`, `en-GB`, `fi-FI`).

## Key naming

- Put chat content under `chat.*` keys (slash-command responses, chat status rows, chat progress/error text).
- Keep CLI-only command text under `cli.*` keys.
- Reserve `tui.*` for terminal UI chrome only (panel labels, key hints, picker/footer framing), not chat content.
- Prefer one stable key per message intent; avoid duplicate keys for the same user-visible string.
