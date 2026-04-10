# Localization

How Acolyte separates translatable user-facing copy from language-neutral protocol contracts.

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

## Baseline policy

- new protocol/tool contracts must use stable identifier-style names (not natural-language labels)
- user-facing copy should stay in presentation layers so translation can be added without changing protocol/tool contracts

## Current behavior

- Locale is configurable via config (`locale` key, for example `acolyte config set locale en`).
- English messages are defined in `src/i18n/en.ts`. Additional locales are discovered from `src/i18n/locales/*.json`.
- Adding a new locale requires adding one JSON file named `<locale>.json` with a complete catalog matching the English key set.
- Locale tags use BCP-47 style with `-` separators (for example `en`, `en-GB`, `fi-FI`).

## Key naming

- put chat content under `chat.*` keys (slash-command responses, chat status rows, chat progress/error text)
- keep CLI-only command text under `cli.*` keys
- reserve `tui.*` for terminal UI chrome only (panel labels, key hints, picker/footer framing), not chat content
- prefer one stable key per message intent; avoid duplicate keys for the same user-visible string
