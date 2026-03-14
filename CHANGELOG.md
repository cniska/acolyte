# Changelog

## 0.3.1 (2026-03-14)

- **chat:** replace /tokens with /usage and add prompt breakdown (#10) (`beabe48`)
- **chat:** slash command output swallowed on alternate submits (`a2d0a8d`)
- **lifecycle:** strip @signal line regardless of position in output (`22bf5a0`)
- refresh benchmark metrics (`120a50e`)


## 0.3.0 (2026-03-14)

- **tui:** resolve lint warnings from custom-renderer branch (`e95a148`)
- **lint:** fail on biome warnings (`2042d27`)
- auto-generate changelog on release, backfill history (`8899553`)
- **lifecycle:** improve lifecycle feedback loop (#6) (`2f6907d`)
- **tsconfig:** tighten module compiler options (`8557822`)
- **tui:** harden strict mode transcript rendering (`052315d`)
- **skills:** add docs audit (`374f5d9`)
- reconcile canonical docs (`1f2da95`)
- **format:** align strict mode ui formatting (`feb6a6f`)
- refresh benchmarks and workflow policy (`fa71074`)
- **cli:** support local models via ollama setup (#7) (`0cea68e`)
- **lifecycle:** add completion signaling (#8) (`e06a379`)
- **release:** avoid bash regex parse error (`d124e51`)


## 0.2.0 (2026-03-13)

- **skills:** add unified /review skill for branch audits (`6aa1a220`)
- lifecycle hardening — loop guards, lint evaluator, stream types (`23277c1b`)
- **server:** harden local auth and stabilize hermetic tests (`2c25cafd`)
- **agent:** per-tool timeout and guard circuit breaker (`336a6613`)
- **chat:** fix skill slash command activation (`0809ed5d`)
- **chat:** consolidate message contract into chat-contract (`572d8048`)
- **tui:** custom React terminal renderer (`501c43ef`)

## 0.1.1 (2026-03-13)

- remove talks directory (`cdc5429f`)
- **benchmark:** combine scripts into single benchmark.ts (`84400ef9`)
- **dev:** ensure ~/.acolyte exists before server log redirect (`19525e2d`)
- **ci:** fix lint errors in benchmark.ts, update version snapshot (`b12ede01`)

## 0.1.0 (2026-03-12)

Initial release.
