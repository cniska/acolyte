---
name: security-audit
description: Audit practical security risks including auth, workspace boundaries, command safety, secret handling, and protocol abuse. Use when reviewing security posture, hardening defaults, or assessing risk before release.
---

# Security Audit

Use this skill when asked to review security posture, harden defaults, or assess risk before release.

## Scope

Focus on practical, exploitable security issues and unsafe defaults.

### 1. Trust boundaries and access control

Check:

- auth and trust boundaries (server key checks, RPC access, local-vs-remote assumptions)
- authorization gaps between clients, sessions, tasks, and workspace-scoped operations
- endpoint exposure and listener defaults
- assumptions that are safe only for local development but unsafe if exposed remotely

### 2. Transport and encryption posture

Check:

- transport security over the wire (`http/ws` vs `https/wss`)
- whether any remote-accessible path allows insecure transport
- whether sensitive payloads, credentials, tokens, or task data can traverse insecure channels
- encryption in transit for all remote traffic
- at-rest protection for persisted sensitive data where applicable
- key and secret handling: env-based sourcing, redacted logs, no plaintext persistence unless explicitly intended

### 3. Workspace and execution boundaries

Check:

- workspace/path boundary enforcement for file tools
- path traversal and escaping project roots
- shell/tool execution safety and permission-mode enforcement
- whether write, exec, or network-capable tools can bypass intended policy
- whether destructive or irreversible operations are guarded appropriately

### 4. Protocol abuse and resource exhaustion

Check:

- malformed payload handling and schema validation
- queue flooding, task spam, oversized input, or replayable request patterns
- timeout, retry, cancel, and backpressure consistency
- whether cancellation or retry behavior can leave the system in unsafe or inconsistent states
- denial-of-service risks from unbounded work, logs, tool execution, or memory growth

### 5. Secret exposure and error surfaces

Check:

- secrets in logs, errors, traces, snapshots, or test fixtures
- secret leakage through tool output, RPC responses, or lifecycle events
- whether error messages expose implementation details, tokens, paths, or private context unnecessarily
- whether tests accidentally normalize insecure patterns

### 6. Defaults and dependency posture

Check:

- config defaults that create insecure behavior
- unsafe opt-out flags or weak default modes
- dependencies or integration assumptions that expand attack surface
- whether current defaults match the documented security posture

## Evidence threshold

Only report a security finding when there is a concrete attack path, trust-boundary failure, or unsafe default supported by code, config, protocol flow, or test evidence.

Do not make speculative recommendations without a plausible abuse path.

Prefer findings with clear impact and a realistic trigger condition.

## References

Read first:

- `docs/architecture.md`
- `AGENTS.md`
- `docs/roadmap.md` (pre-OSS security baseline)

Then inspect code, especially:

- `src/server*.ts`
- `src/client*.ts`
- `src/rpc-*.ts`
- `src/protocol*.ts`
- `src/core-tools.ts`
- `src/*tools*.ts`
- `src/tool-guards.ts`
- `src/config*.ts`
- `src/env.ts`
- `src/error-handling.ts`

Also inspect relevant tests:

- `src/*.test.ts`
- `src/*.int.test.ts`

Expand beyond these files if the diff or trust-boundary analysis leads elsewhere.

## Audit workflow

1. Map entry points, exposed surfaces, and trust boundaries.
2. Classify each boundary:
   - local-only
   - authenticated local
   - remote-accessible
   - privileged execution
3. Check each boundary for:
   - validation
   - authorization
   - safe defaults
   - least-privilege behavior
4. Audit transport and encryption posture:
   - local-only paths may use `http/ws`
   - remote-accessible paths must use `https/wss` or an explicitly documented equivalent secure transport
   - confirm no sensitive payloads or credentials traverse insecure remote channels
5. Identify exploitable paths:
   - read
   - write
   - execute
   - network
   - persist
6. Assess abuse potential:
   - unauthorized access
   - data exfiltration
   - arbitrary execution
   - privilege boundary bypass
   - denial of service
   - secret leakage
7. Report findings ordered by severity:
   - **critical**: direct unauthorized access, secret disclosure, arbitrary code execution, or destructive cross-boundary impact
   - **high**: realistic abuse with significant security impact
   - **medium**: defense gaps or unsafe defaults likely to become exploitable
   - **low**: hygiene, observability, or hardening improvements
8. For each finding, provide:
   - affected files
   - concrete attack or failure path
   - why current behavior is risky
   - smallest effective fix
   - regression test idea
9. Distinguish confirmed findings from open questions and optional hardening.
10. Prefer minimal hardening that fits the current architecture over policy-heavy redesigns.

## Output format

Findings first, ordered by severity. No long preamble.

For each finding include:

- **severity**
- **affected files**
- **attack / failure path**
- **why current behavior is risky**
- **smallest effective fix**
- **recommended test coverage**

Then include:

- **Confirmed findings**
- **Open questions / assumptions**
- **Optional hardening follow-ups**

## Review rules

- Prefer concrete exploit paths over abstract risk language.
- Prefer small, testable remediations over broad security rewrites.
- Do not recommend enterprise-style controls unless the current product surface actually needs them.
- Anchor recommendations in the documented architecture and current product stage.
- Treat local-only developer tooling assumptions differently from remote multi-tenant risk, but still flag where a “local-only” assumption is unenforced in code.
- When in doubt, explain the exact trust boundary that is being crossed or left undefined.

## Anti-patterns

- Fear-driven or speculative recommendations without concrete attack paths
- Policy-heavy rewrites instead of minimal hardening fixes
- Recommendations that conflict with the current architecture or violate YAGNI
- Treating hypothetical future deployment models as current vulnerabilities without evidence
- Security advice that is not actionable or testable