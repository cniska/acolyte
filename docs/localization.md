# Localization

Localization baseline for OSS readiness.

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

- No user locale configuration in TUI yet.
- New protocol/tool contracts must use stable identifier-style names (not natural-language labels).
- User-facing copy should stay in presentation layers so translation can be added without changing protocol/tool contracts.

## Next step after MVP

Add locale selection and translation resources for CLI/TUI copy without changing protocol or tool output contracts.
