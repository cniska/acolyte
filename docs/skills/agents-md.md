---
name: agents-md
description: Create and update AGENTS.md project rules. Use when authoring or amending the cross-tool conventions agents must follow.
---

# AGENTS.md

`AGENTS.md` holds the cross-tool project rules — the conventions any coding agent must follow in this repo. Two modes, detected by whether one already exists at the target: **Create** (none exists) infers rules from evidence; **Update** (one exists) merges a new rule into the right section and trims what it duplicates. Updating is the harder half: never blind-append.

Acolyte injects `AGENTS.md` as project rules on every task and syncs it to a project-scoped memory record (`mem_agentsmd`); edits take effect on the next turn. Every line has a recurring token cost — keep it lean.

## Conventions this file must follow (and enforce)

- One logical rule per bullet.
- Never hard-wrap markdown — one line per bullet or paragraph, let it soft-wrap.
- State the rule, not its history — "no X" beats "we used to allow X but now".
- Reuse the existing file's vocabulary — don't coin a synonym for a concept already named.
- Keep it lean — prefer trimming to growing. A new rule shouldn't grow the file if an existing bullet can absorb it. Target under 80 lines; AGENTS.md is loaded on every task and every line has a recurring token cost.
- For any comment guidance it generates, take the self-documenting-code stance: comment the *why* that can't be encoded in a name, type, or test — never the *what*.

## Standard sections

Use only the sections with something concrete to say — an empty section is noise. Order them so the load-bearing rules come first:

- **Architecture** — module boundaries, entry points, what depends on what. Keep this section to a single reference line pointing to a dedicated architecture doc when one exists; suggest extracting and referencing when the section exceeds five bullets. AGENTS.md is loaded on every task — a long Architecture section belongs in a doc humans and agents can read on demand.
- **Invariants** — rules that must never break; the non-negotiables.
- **Workflow** — how to build, run, and verify locally.
- **Commits** — message format and discipline (defer to the `git` skill's Conventional Commits unless the repo overrides).
- **Pull requests** — when to open one, the review gate, title and body rules (omit if the project doesn't use PRs).
- **Code** — language and structure rules specific to this repo.
- **Style** — formatting, naming, lint/format tool of record.
- **Docs** — where docs live and when to update them.
- **Testing** — test layout, how to run them, coverage expectations.

## Workflow

### Create mode

No AGENTS.md exists. Infer the project's *real* conventions from evidence — never invent aspirational rules the code doesn't follow.

1. Gather evidence:
   - lint/format config (`biome.json`, `.eslintrc*`, `.prettierrc*`, `rustfmt.toml`, `ruff.toml`) — the style section writes itself from these.
   - test layout and scripts (`package.json` scripts, test dirs, CI config).
   - framework and runtime (manifest files, lockfiles).
   - commit style from `git log --oneline -30` — copy the format actually in use.
   - existing agent rule files (`.cursorrules`, other memory files) — migrate the real rules, drop tool-specific memory.
2. Draft standard sections **only where evidence supports a concrete rule**. Skip the rest.
3. Follow every convention above — one rule per bullet, no hard wrap, terse.
4. Report which sections you filled and what evidence backed each.

### Update mode

AGENTS.md exists and you're adding a rule or change. This is a merge, not an append.

1. Read the whole file first — you can't dedupe what you haven't read.
2. Find the section the rule belongs in. Match the file's existing vocabulary and structure.
3. **Merge, don't append:**
   - if an existing bullet overlaps, rewrite that one bullet to cover both — don't add a second.
   - if the rule generalizes several existing bullets, replace them with the one general rule.
   - if the same rule is stated in two sections, dedupe to the single correct home.
4. Trim collateral duplication the change exposes, even outside the target section.
5. Re-check the file still follows every convention above (no hard wraps, one rule per bullet).
6. Report **added / merged / trimmed** explicitly — which bullets changed and why.

Concrete target behavior: adding a "comments" rule should absorb a pre-existing "no banner comments" bullet into it, not sit beside it; a rule that appears in both Style and Code should end up in one section only.

## See also

AGENTS.md is the hub that gives the other skills their project-specific grounding. Each skill reads it to understand what the project considers non-negotiable.

- `git` — the Commits section defers to the `git` skill's Conventional Commits format unless the repo overrides it.
- `tdd` — the Testing section describes the surface the `tdd` skill drives against: test layout, run command, boundary mocking policy.
- `review` — the Invariants section is the checklist review verifies. An invariant with no test and no review coverage is incomplete.
- `doc-review` — the Docs section states when to update canonical docs; the `doc-review` skill enforces it.

## Red flags

- Letting the Architecture section grow to more than five bullets instead of suggesting extraction to a dedicated architecture doc.
- Blind-appending a new rule instead of merging it with the overlapping bullet.
- Hard-wrapping bullets to a column width.
- Inventing rules the codebase doesn't actually follow.
- Coining a new term for a concept the file already names.
- Growing the file when an existing bullet could have absorbed the rule.
- Putting harness config or tool-specific agent memory into AGENTS.md.
- Comment guidance that describes *what* the code does rather than *why*.
