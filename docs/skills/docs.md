---
name: docs
description: Review docs for drift, missing updates, and terminology changes. Use when code changes should be reflected in documentation.
---

# Documentation

Review doc coverage, terminology drift, and canonical doc accuracy.

## Scope

- canonical doc updates for behavior, contract, or config changes
- glossary drift when new terms are introduced
- duplicated concepts across documentation files
- outdated names or contracts after refactors
- docs staying conceptual rather than describing implementation line-by-line

## Workflow

1. Identify which docs are affected by the code change.
2. Check for terminology drift — renamed concepts, changed contracts, new terms without definitions.
3. Check for stale content — does the doc still describe what the code actually does?
4. Check for duplication — is the same concept explained in multiple places?
5. Follow the project's documentation conventions for style and structure.

## Output

For each finding: **severity**, **affected file**, **what drifted or is missing**, **fix direction**.

Then: **Canonical updates needed** | **Optional cleanup**.

## Red flags

- Generic prose polishing
- Duplicate explanations across docs
- Implementation detail where a concept is enough
- Treating issue descriptions as shipped behavior
