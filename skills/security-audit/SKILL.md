---
name: security-audit
description: Audit Acolyte for practical security risks (auth, workspace boundaries, command/tool safety, secret handling, and protocol abuse) and recommend minimal high-impact fixes.
---

# Security Audit

Use this skill when asked to review security posture, harden defaults, or assess risk before release.

## Scope

Prioritize:
- auth and trust boundaries (server key checks, RPC access)
- security over the wire (HTTP/WS vs HTTPS/WSS, endpoint exposure, transport expectations)
- encryption controls (in transit and at rest where applicable)
- reliability abuse surface (timeout/retry/cancel consistency, queue/backpressure behavior)
- workspace/path boundaries for file and command tools
- shell/tool execution safety and permission-mode enforcement
- secret handling (env vars, logs, error surfaces, tests)
- protocol abuse risks (queue flooding, task spam, malformed payloads)
- dependency and config defaults that create insecure behavior

## Canonical References

Read first:
- `docs/architecture.md`
- `AGENTS.md`
- `docs/roadmap.md` (pre-OSS security baseline)

Then inspect code:
- `src/server.ts`, `src/client.ts`, `src/rpc-*.ts`, `src/protocol*.ts`
- `src/core-tools.ts`, `src/*tools*.ts`, `src/tool-guards.ts`
- `src/config*.ts`, `src/env.ts`, `src/error-handling.ts`
- relevant tests under `src/*.test.ts` and `src/*.int.test.ts`

## Audit Workflow

1. Map entry points and trust boundaries.
2. Check each boundary for validation, authorization, and safe defaults.
3. Audit transport security:
- local-only paths may use `http/ws`; remote-accessible paths must use `https/wss`
- confirm no sensitive payloads or credentials traverse insecure remote channels
4. Audit encryption posture:
- in-transit protections for all remote traffic
- at-rest protections for persisted sensitive data when present
- key/secret handling: env-based, redacted logs, no plaintext persistence
5. Identify exploitable paths (read/write/exec/network), then rate impact/likelihood.
6. Report findings by severity:
- critical: direct unauthorized access/data loss/code execution
- high: realistic abuse with significant impact
- medium: defense gaps likely to become issues
- low: hygiene and observability improvements
7. Provide minimal remediations and regression test ideas for each finding.

## Output Format

- Findings first, ordered by severity
- For each finding include:
- affected files
- attack/failure path
- why current behavior is risky
- smallest effective fix
- recommended test coverage
- Then list:
- open questions/assumptions
- optional hardening follow-ups

## Guardrails

- Avoid fear-driven or speculative recommendations.
- Prefer concrete, testable fixes over policy-heavy rewrites.
- Keep recommendations aligned with current architecture and YAGNI.
