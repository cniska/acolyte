# FAQ

Quick operational answers for common developer questions.

## Is memory always on?

By default, yes. Control behavior: see [memory.md](./memory.md).

- Per request: `useMemory=false` disables memory injection and commit.
- Global config: `memoryBudgetTokens=0` disables memory injection.

## What is the difference between `stored` and distill sources?

- `stored`: explicit Markdown memory records managed by CLI commands.
- distill sources: automatic observations/reflections extracted from conversation flow.

## How is memory source order controlled?

With `memorySources` config. Example:

```toml
memorySources = ["stored", "distill_session"]
```

Order is the Memory Source Strategy order used by the Memory Engine.

Memory behavior details: see [memory.md](./memory.md).

## Why is commit concurrency defined per process?

Memory commit serialization uses an in-memory keyed task queue.  
This guarantees per-process ordering per session.

## Why use atomic writes for distill records?

Distill record writes use `temp -> rename` to avoid partial files on interruption.
