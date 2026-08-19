---
phase: 01
slug: secure-vault-setup-unlock
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-08-19
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser ↔ loopback API | Client (Vite dev server / built SPA) talks to the Express API over `http://127.0.0.1:5174` only, guarded by same-origin middleware | Master password (in-flight only, never at rest), session status, encrypted vault entries |
| Server process ↔ filesystem | `vault.meta.json` (sidecar) and `vault.db` (SQLite) persisted to disk | Ciphertext, IVs/tags/salt, non-secret KDF params — no plaintext secrets ever written |
| Server process ↔ in-memory Vault Key | Derived Vault Key exists only as a `Buffer` in the Node process for the unlocked session's lifetime | Plaintext key material — must never cross the two boundaries above |
| Local OS process tree ↔ `dev.mjs` | Dev-only: `npm run dev` spawns/tree-kills tsc/node/vite children via Windows console signals and `taskkill` | Process IDs, command lines (dev tooling only — no vault secrets in this boundary) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-01 | Info Disclosure | server bind | critical | mitigate | Structurally loopback-only bind, throws before listen if non-loopback | closed |
| T-01-02 | Info Disclosure | logging | high | mitigate | Recursive Buffer+key redactor in log.ts; error handler logs no body/stack | closed |
| T-01-03 | Tampering | dependencies | high | mitigate | Pinned versions asserted by deps.test.ts; no unscoped zxcvbn-ts | closed |
| T-01-04 | Elevation of Privilege | KDF | high | mitigate | Argon2id cost params measured (474ms median) and pinned in config.ts | closed |
| T-01-05 | Tampering | native deps / engine pin | medium | mitigate | **OPEN (non-blocking, below `high` threshold).** No mechanical gate exists for the "install must not silently fall back to source compilation" guard; runtime is Node v24.19.0 while `engines.node` pins `>=20.19.0 <21` — the guard was bypassed in practice (01-04-SUMMARY deviation #2, `npm rebuild`). Pre-existing debt, not introduced by this phase's gap-closure work. | open |
| T-01-06 | DoS | body size | low | accept | `express.json({limit:"100kb"})` | closed |
| T-01-07 | Repudiation | audit trail | low | accept | Deferred to Phase 3 (TRUST-03); git history in the interim | closed |
| T-02-01 | Tampering | envelope encryption | critical | mitigate | Fresh `randomBytes(12)` IV per `wrapKey` call, never a parameter | closed |
| T-02-02 | Elevation of Privilege | KDF salt | high | mitigate | `randomBytes(16)` per-vault salt; Argon2id raw mode | closed |
| T-02-03 | Info Disclosure | key handling | high | mitigate | `masterKey.fill(0)` before response; response body is status-only | closed |
| T-02-04 | Spoofing | DB auth | high | mitigate | Cipher key forces a `user_version` read to fail fast on wrong key | closed |
| T-02-05 | Tampering | atomic writes | high | mitigate | tmp→fsync→rename; partial artifacts removed on failure | closed |
| T-02-06 | Info Disclosure | browser autofill | medium | mitigate | `new-password` autocomplete + form `autocomplete=off`; no Web Storage use | closed |
| T-02-07 | Info Disclosure | file permissions | medium | mitigate | Vault directory created `mode: 0o700` | closed |
| T-02-08 | DoS | vault creation | low | accept | Loopback-only; 409 returned before derivation | closed |
| T-02-09 | Repudiation | creation audit | low | accept | `createdAt` persisted; full audit deferred to Phase 3 | closed |
| T-03-01 | Info Disclosure | unlock failure | high | mitigate | Single generic error-response construction site; original error never passed through | closed |
| T-03-02 | Info Disclosure | 2FA field disclosure | high | mitigate | Field rendered from `totpEnabled` prop, not a prior round trip | closed |
| T-03-03 | Elevation of Privilege | session lock | critical | mitigate | Key zeroed + nulled + DB destroyed + timer cleared in one atomic body | closed |
| T-03-04 | Elevation of Privilege | idle-timer arming | high | mitigate | Single prod call site for `armIdleTimer`; `/status` mounted outside it | closed |
| T-03-05 | Spoofing | unlock rate limiting | high | mitigate | 60s/10-attempt limiter mounted on `/unlock` only | closed |
| T-03-06 | Info Disclosure | password field | medium | mitigate | `current-password` autocomplete; state cleared on both outcomes | closed |
| T-03-07 | Tampering | session signal spoofing | high | mitigate | Client signal is accelerant-only; server timer independent | closed |
| T-03-08 | DoS | lockout durability | medium | accept | No durable lockout; documented rationale | closed |
| T-03-09 | Repudiation | lock/unlock audit | low | accept | Deferred to Phase 3 (TRUST-03) | closed |
| T-04-01 | Elevation of Privilege | 2FA ordering | critical | mitigate | Master-password unwrap precedes second-factor verification; TOTP never derives the master key | closed |
| T-04-02 | Tampering | TOTP secret storage | high | mitigate | TOTP secret wrapped with Vault Key; sidecar byte-scan confirms no plaintext | closed |
| T-04-03 | Info Disclosure | 2FA failure disclosure | high | mitigate | All 2FA failures route through the same generic error response | closed |
| T-04-04 | Elevation of Privilege | backup code reuse | high | mitigate | `timingSafeEqual` + length check; hash removed and sidecar written before return | closed |
| T-04-05 | Elevation of Privilege | 2FA disable | high | mitigate | Requires master-password re-auth + rate limit | closed |
| T-04-06 | Info Disclosure | backup codes | high | mitigate | Digests only, never re-served; regeneration replaces the whole set | closed |
| T-04-07 | Spoofing | TOTP replay window | medium | accept | 30s epoch tolerance keeps the window tight | closed |
| T-04-08 | Tampering | pending enrollment | medium | mitigate | Module-private Map with 5-min TTL; never persisted pre-confirmation | closed |
| T-04-09 | DoS | enrollment | medium | accept | Direct consequence of accepted D-05 | closed |
| T-04-10 | Info Disclosure | QR/log redaction | high | mitigate | Redaction pattern widened to cover `uri|url|qr|blob|data` | closed |
| T-01-12 | Info Disclosure | dev.mjs process tree | high | mitigate | Awaited `taskkill /T /F` tree-kill; zero-survivor harness; human UAT-confirmed | closed |
| T-01-13 | Elevation of Privilege | dev.mjs shell usage | medium | mitigate | `shell:false` on every spawn path (build, children, taskkill) | closed |
| T-01-14 | Info Disclosure | process enumeration scope | medium | mitigate | Harness prints only its own descendant tree; no report file written | closed |
| T-01-15 | DoS | detached-child force-kill | medium | accept | Documented recovery via harness `finally` cleanup | closed |
| T-01-16 | Tampering | entrypoint drift | low | accept | Drift guard test asserts client `dev` script is still exactly `vite` | closed |
| T-01-17 | DoS | harness/dev-stack port collision | low | mitigate | Harness binds both ports first, names the occupied one, exits before spawning | closed |

*Status: open · closed · open — below `high` threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `workflow.security_block_on` (high) count toward `threats_open`*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

**Unregistered surfaces noted by the audit (not threats in the formal register, tracked here for visibility):**
- Same-origin/CSRF control (`server/src/middleware/sameOrigin.ts`) — introduced by the review-fix wave (WR-04), not any plan; implemented and tested, but has no threat ID. Commit `d8da112` later widened `ALLOWED_ORIGINS` from one origin to two (`127.0.0.1` + `localhost`) with no register entry recording that change.
- `scripts/dev.mjs` stdin control channel (`q`/`stop`) — dev-tooling only; any local process able to write to its stdin can stop the dev stack.
- `__unsafeTestOnlyObserveSession` test-only session accessor — inertness guard (`process.env.VITEST !== "true"`) verified present.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-01-06 | Body size capped at 100kb; DoS surface is minimal on a loopback-only single-user API | Project (PLAN.md threat register) | 2026-08-19 |
| AR-02 | T-01-07 | Full access audit log is TRUST-03, explicitly deferred to Phase 3; git history covers the interim | Project (PLAN.md threat register) | 2026-08-19 |
| AR-03 | T-02-08 | Loopback-only binding + 409-before-derivation bounds the DoS surface for vault creation | Project (PLAN.md threat register) | 2026-08-19 |
| AR-04 | T-02-09 | Creation-time audit trail deferred to Phase 3 (TRUST-03); `createdAt` persisted meanwhile | Project (PLAN.md threat register) | 2026-08-19 |
| AR-05 | T-03-08 | No durable lockout beyond the in-memory rate limiter; single-user local tool, documented rationale | Project (PLAN.md threat register) | 2026-08-19 |
| AR-06 | T-03-09 | Lock/unlock audit trail deferred to Phase 3 (TRUST-03) | Project (PLAN.md threat register) | 2026-08-19 |
| AR-07 | T-04-07 | 30-second TOTP replay window is standard practice and kept intentionally tight | Project (PLAN.md threat register) | 2026-08-19 |
| AR-08 | T-04-09 | Direct, accepted consequence of decision D-05 | Project (PLAN.md threat register) | 2026-08-19 |
| AR-09 | T-01-15 | Detached children could survive a hard force-kill of dev.mjs itself; harness `finally` block documents the manual recovery path | Project (01-05-PLAN.md threat register) | 2026-08-19 |
| AR-10 | T-01-16 | Entrypoint-resolution drift risk is low-severity and covered by an automated drift-guard test | Project (01-05-PLAN.md threat register) | 2026-08-19 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-19 | 41 | 40 | 1 (T-01-05, medium — non-blocking) | gsd-security-auditor |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed (blocking threshold is `high`; T-01-05 is `medium` and does not count)
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-08-19

**Follow-up (non-blocking, tracked for a future phase or maintenance pass):** T-01-05 — add a mechanical engine/native-build gate (`.npmrc` `engine-strict=true` plus a `deps.test.ts` assertion on `process.version` against `server/package.json`'s `engines.node`), then either align the runtime to the pinned Node 20 line or deliberately widen the pin to Node 24 and re-measure the KDF benchmark.
