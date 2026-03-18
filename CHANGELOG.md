# Changelog

## 0.6.0 (2026-03-18)

- **init:** re-prompt on empty API key instead of erroring (`82790e18`)
- **benchmarks:** fix duplicate note and align inconsistent numbers (`64424416`)
- remove chat mode terminology (`f970e216`)
- **lifecycle:** fail fast when AI SDK rejects outside the reader chain (`c2f0b213`)
- **provider:** add Anthropic, Google, and multi-provider coverage (`66211450`)
- **tests:** extract lifecycle tests into per-module files (`7c200a61`)
- remove known-issues now that both items are resolved (`8c91f096`)
- **search-files:** add structured recovery (#15) (`814176c1`)
- **benchmarks:** add Plandex with Go language support (`74135dde`)
- align messaging with terminal-first reliable agent positioning (`38b62a8d`)
- **skills:** add missing docs and update all audit skills (`eb45c287`)
- **benchmark:** fix biome formatting in Go helpers (`49f5290d`)
- **lifecycle:** rename runLifecycleWith and remove LifecycleResult (`8bbf99c4`)
- **trace:** add handlers for lifecycle.generate.done and lifecycle.signal.accepted (`c6dcc561`)
- **file-toolkit:** gitignore-based file discovery (#18) (`8797a599`)
- **code-toolkit:** scoped structural rename (#20) (`ec952b76`)
- **scan-code:** enclosingSymbol and withinSymbol (#21) (`5c4b3a79`)
- **lifecycle-signal:** signal is now a suffix; suppress text after it (`2dd15ef3`)
- **skills:** add benchmark skill to refresh docs/benchmarks.md (`7bdc5975`)
- **benchmark:** extract external imports and schema validation metrics (`3c8bb0e5`)
- **benchmarks:** mention benchmark skill (`6be5300e`)
- **docs:** update benchmarks 16 March 2026 (`abd39500`)
- **benchmarks:** add takeaway prose for dependency and validation sections (`41f48a88`)
- consistency pass for website launch (`5f4b0b68`)
- **comparison:** add lead texts to feature overview and architecture sections (`f44f2178`)
- **format:** split long import and collapse short if condition (`e6e902b3`)
- **skills:** add /ship pre-deploy skill, simplify release.sh (`096104fe`)
- **skills:** add /review-plan adversarial plan review skill (`f1261725`)
- add Codex to benchmarks and comparison, refine metrics and tables (`be69fa2a`)
- **lifecycle:** correct token budget accounting and remove inline warning (`0f622c7d`)
- **usage:** rework /usage output to match /status style (`8c7f7d35`)
- add code of conduct (`5218b20b`)
- **lint:** fix unused param, formatter, and blank line issues (`e536b842`)
- **test:** remove stale warning field from SessionTokenUsageEntry fixture (`6e564fe4`)
- **chat:** structured display types and pending state (#23) (`55b76e77`)
- **release:** move benchmarks from release.sh to ship skill (`10f5eb62`)
- **hooks:** add commit convention guard to pre-push and CI (`70d6f1e0`)
- **docs:** update benchmarks 18 March 2026 (`4d350e11`)


## 0.5.0 (2026-03-15)

- **edit-file:** harden bounded edit recovery (#9) (`02c1709`)
- **agents:** tighten rules and add invariants section (`2089fa3`)
- **readme:** add status badges (`fda6506`)
- **code-toolkit:** add structured AST operations (#11) (`93f5c3a`)
- refresh release documentation (`41e3e4b`)
- **release:** detect bumps from latest tag (`0429276`)


## 0.4.0 (2026-03-14)

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
