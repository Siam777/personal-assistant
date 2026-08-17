# Phase 1: Secure Vault Setup & Unlock - Context

**Gathered:** 2026-08-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can create a master-password-protected vault and unlock it safely, with real encryption at rest and session auto-lock guarding every entry that will ever be stored in it. This phase delivers: vault initialization (master password → envelope encryption), unlock/reject flow, optional TOTP 2FA on top of the master password, and true session auto-lock that destroys the in-memory key. It does NOT deliver vault entry CRUD, organization, search, clipboard, audit log, backup, or OCR — those are later phases.

</domain>

<decisions>
## Implementation Decisions

### Trust Model / Where Crypto Happens
- **D-01:** Crypto is **server-mediated (Node-side)**, not zero-knowledge/browser-side. The local Node API process performs Argon2id key derivation and manages whole-DB-file encryption via `better-sqlite3-multiple-ciphers`. This resolves a direct conflict between the two Phase-1 research docs: `STACK.md` recommends this server-side model (native `argon2`, whole-DB cipher); `ARCHITECTURE.md` recommends a zero-knowledge browser-side model (WASM Argon2id + Web Crypto AES-GCM, server only ever sees ciphertext). **The user explicitly chose server-side** ("use server side. make it secure") — do not follow `ARCHITECTURE.md`'s browser-side crypto/zero-knowledge design or its Next.js API-route structure for the crypto boundary. — **Reversibility:** one-way — **rationale:** switching to a zero-knowledge model later requires re-architecting the client/server security boundary and a full re-encryption migration of every existing vault; this is the foundational trust decision every later phase builds on.
- **D-02:** Because crypto happens server-side, "make it secure" applies as: bind the local API strictly to `127.0.0.1` (never `0.0.0.0`); never log the master password or derived key at any level; hold the derived Master/Vault key only in server-process memory for the unlocked session, zeroed on lock; re-derive on each unlock rather than persisting it. This directly follows `PITFALLS.md` Pitfall 2/3/5 guidance, adapted from "browser-only" to "local Node process" as the trust boundary.

### Auto-Lock
- **D-03:** Idle timeout is **5 minutes**. On timeout, the derived key must be actually zeroed/dropped from memory (not just a UI route change to a lock screen) — per `PITFALLS.md` Pitfall 3, this is the #1 way "lock" gets half-implemented.
- **D-04:** Claude's discretion applied for additional lock triggers beyond idle timeout (user specified duration only): also lock on tab/window close and extended backgrounding, per pitfalls research recommendation for high-value credential vaults. — **Reversibility:** reversible — rationale: purely a config/trigger-wiring change, no data migration involved.

### Recovery Policy
- **D-05:** **Hard no-recovery, with a loud/unmissable warning** at vault creation ("There is no password reset. Losing this password means losing all data."). No recovery-key mechanism exists in this phase. — **Reversibility:** costly — **rationale:** adding a recovery mechanism later requires a new key-wrapping path applied retroactively to every existing vault (migration), not just a new UI screen.

### 2FA (TOTP)
- **D-06:** TOTP 2FA is an **optional add-on offered after initial vault setup** (not forced during first-run), configurable later from settings. Enrollment generates **one-time backup codes**, shown once, which the user must save — these are the escape hatch if the authenticator app is lost. Per `PITFALLS.md` and `STACK.md`: the TOTP secret itself must be encrypted at the same standard as vault secrets (never stored as a plaintext convenience field), and full re-authentication (master password) is required to view/reset/disable 2FA.

### Claude's Discretion
- Exact KDF cost parameters (Argon2id memory/iterations/parallelism) — tune per `PITFALLS.md` guidance (OWASP 2024+ minimums, higher since this is a single-user local app with no server-cost constraint), targeting the ~0.5-1s unlock latency noted in `ARCHITECTURE.md` Scaling Priorities.
- Master password strength enforcement mechanism (entropy check vs. length minimum vs. zxcvbn-style meter) — not discussed in depth; apply `PITFALLS.md` Security Mistakes guidance (enforce a minimum strength check at creation, warn/block on weak choices) using reasonable judgment during planning.
- Exact backup-code format/count for TOTP (e.g., 10 single-use alphanumeric codes) — standard practice, no strong user preference expressed.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Stack & Library Choices (server-side crypto path — this is the chosen path)
- `.planning/research/STACK.md` — Recommended stack: Node 24.x + Express (local API, bind `127.0.0.1` only), `better-sqlite3-multiple-ciphers` 13.0.3 (whole-DB-file encryption), `argon2` (node-argon2) 0.45.x for Argon2id KDF in **raw mode**, `otplib` 13.4.x (TOTP, v13 functional API) + `qrcode` 1.5.x for 2FA enrollment. Also documents the `better-sqlite3-multiple-ciphers` package-alias caveat (verify against the fork's own README before relying on it) and PRAGMA-key timing note (must run immediately after opening the connection, before any other statement).

### Architecture (server-side crypto boundary applies — ignore the browser-side/zero-knowledge design in this doc)
- `.planning/research/ARCHITECTURE.md` — **Use only the parts consistent with D-01 (server-mediated crypto):** envelope-encryption/key-wrapping pattern (Master Key wraps a random Vault Key — "Pattern 1"), in-memory-only session key with auto-lock ("Pattern 2", adapt "browser JS variable" to "Node process memory"), API-driven local server as the desktop-packaging seam ("Pattern 3" — the Express local API from STACK.md, not the Next.js API routes shown in this doc's diagrams). **Do NOT follow** this doc's client-side WASM Argon2id / Web Crypto zero-knowledge design, its ciphertext-only-network-boundary premise (crypto happens server-side here, not client-side), or its Next.js-based project structure — those assume the trust model this phase explicitly rejected (D-01).

### Pitfalls (apply directly — these are the failure modes this phase must avoid)
- `.planning/research/PITFALLS.md` — Pitfall 1 (rolling your own crypto — use only `argon2`/Node `crypto` primitives, AES-256-GCM, CSPRNG for all salts/IVs), Pitfall 2 (key/secret leakage via XSS-reachable storage — never persist password/key to disk/storage even server-side equivalents), Pitfall 3 (weak lock/session model — lock must zero the key, not just change a UI flag), Pitfall 5 (local server exposed beyond localhost — bind `127.0.0.1` only), Security Mistakes table (unique per-vault salt, generic "Unable to unlock" errors regardless of failure cause, TOTP layered on top of master password not replacing it), UX Pitfalls table (no-recovery warning must be explicit/unmissable, auto-lock should warn before firing).

### Project-Level Constraints
- `.planning/PROJECT.md` — "Industry grade" security bar (real encryption, no plaintext ever, priority #1); local-only storage constraint; must be architected for later desktop packaging (Tauri/Electron-compatible stack).
- `.planning/REQUIREMENTS.md` — SEC-01 through SEC-05 (master password init/encryption, unlock/reject, optional TOTP 2FA, encryption at rest, session auto-lock).
- `.planning/ROADMAP.md` §Phase 1 — Success criteria this phase must satisfy.

[No project-specific ADRs/SPECs exist yet beyond the research docs above.]

</canonical_refs>

<code_context>
## Existing Code Insights

Greenfield project — no code exists yet (empty repository). No reusable assets, established patterns, or integration points to reference. The Recommended Project Structure in `ARCHITECTURE.md` is a Next.js-based layout that does NOT match the chosen Express-based backend from `STACK.md` — downstream planning should establish project structure based on `STACK.md`'s Express + Vite/React choice, adapting only the module-boundary *concepts* (modules/auth, modules/vault, modules/audit as a shared kernel; OCR fully decoupled) from `ARCHITECTURE.md`, not its literal Next.js file layout.

</code_context>

<specifics>
## Specific Ideas

- "Use server side. Make it secure" — explicit instruction to keep crypto server-mediated (Node process) but apply defense-in-depth (localhost-only binding, no logging/persisting of key material, generic error messages on unlock failure).
- 5-minute idle auto-lock, specifically.
- The no-recovery warning must be "loud" — not a subtle disclaimer, but explicit and unmissable at vault creation time.
- Backup codes are required for the TOTP flow — this was a deliberate choice over the simpler "no backup codes, locked out like a forgotten password" option.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 1-Secure Vault Setup & Unlock*
*Context gathered: 2026-08-18*
