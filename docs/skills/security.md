---
name: security
description: Review security risks, trust boundaries, and unsafe defaults. Use when reviewing security posture or assessing risk before release.
---

# Security

Review security posture, trust boundaries, and unsafe defaults.

## Scope

### 1. Trust boundaries and access control

- auth and trust boundaries
- authorization gaps between clients, sessions, and operations
- endpoint exposure and listener defaults

### 2. Transport and encryption

- transport security (HTTP vs HTTPS, WS vs WSS)
- sensitive payloads traversing insecure channels
- key/secret handling: env-based sourcing, redacted logs, no plaintext persistence

### 3. Execution boundaries

- path boundary enforcement for file operations
- path traversal and escaping project roots
- shell/command execution safety
- destructive operations without appropriate guards

### 4. Protocol abuse and resource exhaustion

- malformed payload handling and schema validation
- queue flooding, oversized input, replayable requests
- timeout/retry/cancel consistency
- unbounded work, logs, or memory growth

### 5. Secret exposure

- secrets in logs, errors, traces, or test fixtures
- error messages exposing tokens, paths, or private context

### 6. Defaults and dependencies

- config defaults creating insecure behavior
- unsafe opt-out flags or weak default modes

## Evidence threshold

Only report findings with a concrete attack path, trust-boundary failure, or unsafe default. No speculative recommendations without a plausible abuse path.

## Workflow

1. Map entry points and trust boundaries.
2. Classify each: local-only, authenticated, remote-accessible, privileged.
3. Check validation, authorization, safe defaults at each boundary.
4. Identify exploitable paths (read, write, execute, network, persist).
5. Report findings by severity: critical → high → medium → low.

## Output

For each finding: **severity**, **affected files**, **attack/failure path**, **why risky**, **fix**, **test idea**.

Then: **Confirmed findings** | **Open questions** | **Optional hardening**.

## Red flags

- Fear-driven recommendations without concrete attack paths
- Policy-heavy rewrites instead of minimal hardening
- Treating hypothetical deployment models as current vulnerabilities
- Security advice that is not actionable or testable
