# Phase 1: Secure Vault Setup & Unlock - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-18
**Phase:** 1-Secure Vault Setup & Unlock
**Areas discussed:** Trust model, Auto-lock, Recovery, 2FA flow

---

## Trust Model (where crypto happens)

| Option | Description | Selected |
|--------|-------------|----------|
| Zero-knowledge (browser-side) | Argon2id + AES-256-GCM run entirely in the browser via WASM/Web Crypto; server only ever stores/returns ciphertext. | |
| Server-mediated (Node-side) | Password sent to local Node process once per unlock; Node runs argon2 and better-sqlite3-multiple-ciphers does whole-DB-file encryption. | ✓ |
| Not sure — walk me through the tradeoff | | |

**User's choice:** "use server side. make it secure" (free-text/Other response, mapped to Server-mediated)
**Notes:** This resolves a direct conflict between STACK.md (recommends server-side) and ARCHITECTURE.md (recommends browser-side zero-knowledge). User's answer is authoritative — ARCHITECTURE.md's zero-knowledge/Next.js design is NOT used for the crypto boundary.

---

## Auto-Lock

| Option | Description | Selected |
|--------|-------------|----------|
| Short (2-5 min idle) + tab close/blur | Matches NIST/CIS guidance for high-value credential vaults. | |
| Medium (10-15 min idle) + tab close only | More forgiving for active sessions. | |
| Custom — I'll specify | | ✓ |

**User's choice:** "make it 5 minutes" (free-text/Other response)
**Notes:** User specified duration only. Claude applied discretion to also lock on tab/window close and extended backgrounding, per PITFALLS.md recommendation — recorded as D-04 in CONTEXT.md with a "reversible" rating since it's a config/trigger-wiring choice, not a data-migration concern.

---

## Recovery

| Option | Description | Selected |
|--------|-------------|----------|
| Hard no-recovery, with a loud warning | Explicit, unmissable warning at creation; no recovery mechanism exists. | ✓ |
| Optional printable/offline recovery key | Generates a one-time recovery key as an escape hatch; adds another key-wrapping path to secure. | |

**User's choice:** Hard no-recovery, with a loud warning
**Notes:** Direct selection, no follow-up needed.

---

## 2FA Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Optional add-on after setup, no backup codes | TOTP enabled later from settings; losing the authenticator = locked out, same as forgetting the master password. | |
| Optional add-on after setup, with backup codes | Same enrollment flow, plus one-time backup codes generated at 2FA setup as an escape hatch. | ✓ |

**User's choice:** Optional add-on after setup, with backup codes
**Notes:** Direct selection, no follow-up needed.

---

## Claude's Discretion

- Exact KDF cost parameters (Argon2id memory/iterations/parallelism) — tune per PITFALLS.md guidance targeting ~0.5-1s unlock latency.
- Master password strength enforcement mechanism (entropy vs. length vs. zxcvbn-style meter) — apply PITFALLS.md guidance (enforce minimum, warn/block on weak) using reasonable judgment.
- Exact backup-code format/count for TOTP (e.g., 10 single-use alphanumeric codes) — standard practice, no strong user preference expressed.
- Additional auto-lock triggers beyond the 5-minute idle timeout (tab close, extended backgrounding).

## Deferred Ideas

None — discussion stayed within phase scope.
