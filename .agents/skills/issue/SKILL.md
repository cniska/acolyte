---
name: issue
description: Create a GitHub issue from a short description. Use when filing a bug, feature request, or task.
---

# Issue

Create a GitHub issue from a short description.

## Conventions

- Title: Conventional Commit format (`type(scope): description`), under 60 chars, no trailing period
- Label: `enhancement` for features, `bug` for bugs
- Body sections (in order): **What would you like?**, **Motivation**, **Proposed approach**, **Scope**
- Each section is a `##` heading followed by 1–3 short paragraphs
- Write plainly — no bullet-heavy lists, no implementation detail
- Use normal sentence capitalization in prose sections (especially **Motivation**)
- Inline code only when the identifier is essential to understanding the issue
- Focus on *what* and *why*, not *how* — leave implementation to the branch
- Scope section uses a flat bullet list of affected areas

## Workflow

1. **Understand the idea**: read the user's description carefully — ask if intent is unclear
2. **Check for duplicates**: run `gh issue list --state open --limit 50` and scan for overlap
3. **Draft the issue**: write title and body following the conventions above
4. **Show the draft**: present the title and body to the user for approval before creating
5. **Create the issue**: `gh issue create --title "..." --label "..." --body "..."`
6. **Return only the issue URL**

## Rules

- Never create an issue without showing the draft to the user first
- Never guess the scope — if the idea is vague, ask
- Never add implementation details to the issue body — that belongs in the branch
- Always check for duplicate or overlapping issues
- Keep the body concise — if a section would be one sentence, that's fine

## Red flags

- Creating the issue without checking for duplicates
- Writing implementation plans in the issue body
- Adding too many sections or subsections
- Skipping user approval of the draft
