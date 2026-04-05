---
name: deprecation
description: Deprecate and remove code safely. Use when replacing systems, removing unused features, or consolidating duplicate implementations.
---

# Deprecation

Code is a liability, not an asset. Every line requires maintenance — bug fixes, dependency updates, security patches, cognitive overhead. When equivalent functionality requires less code or better abstraction, the old version should be retired.

## Principles

### Code as liability

Value comes from functionality, not code volume. Less code serving the same purpose is strictly better.

### Hyrum's Law makes removal hard

All observable behaviors become dependencies. Users rely on bugs and undocumented side effects. Deprecation requires active migration, not just announcement.

### No transitional architecture

Don't maintain two systems in parallel. Land the replacement, migrate consumers, remove the old system. Dual systems double maintenance cost.

### The Churn Rule

If you own the infrastructure being deprecated, you are responsible for migrating your users — or providing backward-compatible updates that require no migration.

## Workflow

1. **Build the replacement first.** Never deprecate without a working alternative.
2. **Identify all consumers.** Grep for usages, check imports, trace call paths.
3. **Migrate incrementally.** Move consumers one at a time, verify each migration.
4. **Verify zero usage.** Confirm no remaining references before removing.
5. **Remove completely.** Delete code, tests, documentation, configuration. No commented-out remnants.

## Zombie code

Code with no owner but active dependents. Signs:
- No commits in months with active consumers
- Failing tests left unfixed
- Outdated dependencies

Either assign an owner and maintain it, or deprecate it with a migration plan. Zombie code cannot remain suspended.

## Red flags

- Deprecating without a replacement available
- Multi-month "soft" deprecations with no progress
- New features added to deprecated systems
- Code removal without verifying zero active consumers
- "We'll maintain both indefinitely"
