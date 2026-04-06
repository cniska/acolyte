---
name: benchmark
description: Run benchmarks and update docs/benchmarks.md. Use before releases or when comparing against other projects.
---

# Benchmark

Run the benchmark script, parse its output, and update `docs/benchmarks.md` with fresh numbers and today's date.

## Workflow

1. Always delete `/tmp/acolyte-benchmarks` and reclone all repos before running. Incremental pulls frequently leave repos in a broken state with missing files.
2. Run `bun run scripts/benchmark.ts` and capture the output.
3. Parse the output — each project block lists metric labels and values. Match each value to the corresponding table cell in `docs/benchmarks.md` by project name and metric label.
4. Update every metric value the script covers. Do not change narrative prose, section headings, or table structure.
5. Update the date line at the bottom of the file to today's date in the form `Updated <Day Month Year>.`
6. Commit the result with a message in the form `chore(docs): update benchmarks <date>`.

## Rules

- Update numbers and the date only — leave all prose and table structure intact.
- If a metric from the script has no matching cell in the doc, skip it.
- If a cell in the doc has no corresponding script output, leave it unchanged.
