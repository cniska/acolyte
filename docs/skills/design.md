---
name: design
description: Design stable interfaces that are hard to misuse. Use when defining contracts, module boundaries, or public APIs.
---

# Design

Design interfaces that are hard to misuse, easy to extend, and stable under change. Applies to API contracts, module boundaries, config schemas, and any surface where components interact.

## Principles

### Contract first

Define the interface before implementing it. The schema is the contract — implementation follows.

### Hyrum's Law

All observable behaviors of your system will be depended on by somebody, regardless of what you promise in the contract. Every public behavior becomes a de facto commitment. Be deliberate about what you expose.

### Prefer addition over modification

Extend interfaces by adding optional fields rather than changing existing ones. Changing a field's type or removing it breaks consumers silently. Adding is safe; modifying is not.

### Validate at boundaries

Trust internal code. Validate at system boundaries — API payloads, config files, external inputs. Don't scatter validation deep inside the call stack.

### Predictable naming

Follow established project conventions consistently. When no convention exists, prefer explicit and descriptive over terse and clever.

## Workflow

1. **Identify the boundary.** What calls this? What does it return? Who else might consume it?
2. **Define the schema.** Schema first, types inferred. Include descriptions for non-obvious fields.
3. **Design for the common case.** Make the default behavior correct. Require explicit opt-in for unusual behavior.
4. **Review for misuse.** Can a caller get into a bad state by passing valid-looking but wrong data? Add discriminants or branded types where confusion is likely.
5. **Check extensibility.** Can this be extended without modifying existing consumers?

## Red flags

- Interfaces that require callers to know implementation details
- Fields that mean different things depending on context
- Breaking changes disguised as bug fixes
- Validation scattered through the call stack instead of at the boundary
