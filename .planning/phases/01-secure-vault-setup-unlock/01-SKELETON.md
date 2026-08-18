# Walking Skeleton — Personal Assistant — Vault & Lens

**Phase:** 1
**Generated:** 2026-08-18

## Capability Proven End-to-End

> One sentence: the smallest user-visible capability that exercises the full stack.

A first-run user types a master password into the browser, and the app creates a real
Argon2id-derived, AES-encrypted SQLite vault on disk, writes and reads back a row through the
encrypted connection, and shows the user an unlocked vault — with the derived key held only in
the local Node process's memory.

This is the Phase-1 special case of the tracer: it touches the browser, the localhost-only HTTP
boundary, the KDF, the envelope-encryption layer, the unencrypted metadata sidecar, the encrypted
SQLite file, and the in-memory session holder — every layer this project will ever have on the
vault path — with exactly one path wired through them.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Trust model | Server-mediated crypto in a local Node process; browser holds no key material | D-01 (locked, user-chosen, one-way). The browser submits the password over `127.0.0.1` and renders results; all KDF/encryption happens in the Node process. |
| Runtime | Node.js 20.19.6 (installed), **not** upgraded to 22/24 | User decision post-research: pin Node-20-compatible package lines rather than upgrade the machine's Node. Supersedes RESEARCH.md's Node-22+ dependency table. |
| Backend framework | Express 5.2.1, bound explicitly to `127.0.0.1:5174` | STACK.md recommendation; loopback-only binding is a hard security requirement (D-02, PITFALLS.md Pitfall 5). Express (not Next.js API routes — ARCHITECTURE.md's Next.js layout is explicitly rejected by D-01). |
| Frontend | Vite + React + TypeScript, dev server on `127.0.0.1:5173`, `/api` proxied to the Express server | STACK.md; keeps the client a pure rendering tier and the API boundary explicit, which is the seam a later Tauri/Electron package replaces. |
| KDF | `argon2` (node-argon2) `^0.45.1`, Argon2id in **raw mode** (`raw: true`, `hashLength: 32`) | Memory-hard, OWASP-current. Raw mode yields a Buffer usable directly as an AES-256 key. Raw mode disables `argon2.verify()` — deliberate; see "Password-correctness oracle" below. |
| Envelope encryption | Node built-in `crypto`, AES-256-GCM. Master Key (Argon2id) wraps a random 32-byte Vault Key. | ARCHITECTURE.md Pattern 1, adapted server-side. Lets a future master-password change re-wrap the same Vault Key instead of re-encrypting the whole database. |
| Password-correctness oracle | The AES-256-GCM auth-tag check on unwrapping the Vault Key. No separate verifier hash. | One Argon2id call per unlock (keeps the ~0.5–1s latency target); GCM's tag is already a MAC keyed by the candidate Master Key. |
| Data layer | `better-sqlite3-multiple-ciphers@^12.11.1` (Node-20 line), whole-file encryption, `PRAGMA cipher` then `.key(Buffer)` | Page-level encryption of the entire file means every future table/column/index is encrypted by construction, not by remembering to wrap each new field. |
| Whole-DB cipher | `sqlcipher` mode (AES-256-CBC + HMAC), recorded as `cipher` in `vault.meta.json` | Matches the "AES-256" security bar in the roadmap success criteria. Recording the cipher name in the sidecar keeps the choice migratable (a future re-key reads the old mode from the file) rather than a one-way door. |
| Query builder | `kysely@^0.28.7` (Node-20 line), `SqliteDialect` fed the `better-sqlite3-multiple-ciphers` `Database` instance directly | Kysely's `SqliteDialectConfig` is a structural interface with no package-name check — no `package.json` alias trick needed. |
| Key/metadata storage | Two-file vault: `vault.meta.json` (unencrypted sidecar, ciphertext + non-secret KDF params only) + `vault.db` (whole-file encrypted) | The wrapped Vault Key cannot live inside the file it unlocks. The sidecar holds only salts, IVs, auth tags, ciphertext blobs, and cost parameters — never a plaintext secret. Written temp-file-then-atomic-rename. |
| Session model | Module-scoped singleton in the Node process holding the Vault Key `Buffer` + open DB handle; server-authoritative 5-minute idle timer | Single-user local app — one global unlocked/locked state is correct. The server timer is the security guarantee; browser `beforeunload`/`visibilitychange` hooks are UX accelerants only (D-03, D-04). |
| Lock semantics | `lock()` zeroes the key `Buffer` (`fill(0)`), closes the DB handle, and clears the timer in one synchronous call | D-03: lock must destroy the key, not change a UI flag. Splitting these steps is PITFALLS.md Pitfall 3/4's exact failure mode. |
| 2FA | `otplib@^13.4.1` functional API; TOTP secret AES-256-GCM-encrypted with the **Vault Key**; 10 single-use backup codes stored as SHA-256 digests | D-06. Secret encrypted at the same standard as vault secrets. Note: `verify()` returns `{ valid }`, not a boolean. |
| Validation | `zod@^4.4.3` on every request body; `@zxcvbn-ts/core` for master-password strength at creation | RESEARCH.md Standard Stack. Use the **scoped** `@zxcvbn-ts/*` packages; the unscoped `zxcvbn-ts` package is a different, unvetted package and is forbidden. |
| Recovery | None. Loud, non-dismissible warning at vault creation. | D-05 (locked). No recovery-key mechanism exists in this phase. |
| Directory layout | `server/src/modules/{auth,db}/`, `server/src/middleware/`, `client/src/features/<feature>/`, npm workspaces at the repo root | Adapts ARCHITECTURE.md's module-boundary *concepts* (auth / vault / audit as a shared kernel; OCR fully decoupled) onto the Express + Vite structure from STACK.md, not ARCHITECTURE.md's literal Next.js layout. |
| Local run | `npm run dev` at the repo root spawns tsc-watch + `node --watch` (server) + Vite (client) via `scripts/dev.mjs` — zero extra dependencies | Walking Skeleton requires a documented full-stack run command. No process-manager dependency is added, keeping the audited dependency set exactly as vetted. |

## Stack Touched in Phase 1

- [ ] Project scaffold — npm workspaces, TypeScript, ESLint, Vitest, Vite, `scripts/dev.mjs`
- [ ] Routing — `POST /api/vault/init`, `POST /api/vault/unlock`, `POST /api/vault/lock`, `GET /api/vault/status`, `POST /api/vault/2fa/*`
- [ ] Database — real write (`schema_version` row inserted at vault creation) AND real read (row read back through the keyed connection) in the tracer slice
- [ ] UI — master-password creation form and unlock form wired to the API, with a non-dismissible no-recovery acknowledgement
- [ ] Deployment — documented local full-stack run: `npm run dev` (Express on `127.0.0.1:5174`, Vite on `127.0.0.1:5173` proxying `/api`)

## Out of Scope (Deferred to Later Slices)

> These are deliberately absent from the skeleton. This list prevents later phases from
> re-litigating Phase 1's minimalism.

- Vault entry CRUD of any kind — API keys, logins, notes, cards (Phase 2)
- Folders, categories, tags, search (Phase 2)
- Clipboard copy and clipboard auto-clear (Phase 3)
- Access audit log (Phase 3)
- Encrypted backup export / restore (Phase 3)
- OCR / Lens module (Phase 4)
- Master-password change / re-wrap flow (not required by SEC-01..05; the envelope design makes it cheap to add later)
- Password recovery or recovery keys of any kind (D-05 — permanently out of scope, not deferred)
- Desktop packaging via Tauri/Electron (v2, `PLAT-01`) — the local-API seam is built now, the packaging is not
- Multi-user, shared vaults, cloud sync (out of scope for the whole product)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its
architectural decisions above:

- **Phase 2 — Vault Core:** entry tables land inside the already-encrypted `vault.db`, reached
  through the same Kysely handle the session holds. No new crypto, no new trust boundary.
- **Phase 3 — Trust, Backup & Recovery:** clipboard copy + auto-clear, an audit-log table in the
  same encrypted DB, and encrypted backup/restore that reuses `crypto.ts`'s AES-256-GCM helpers
  and the `vault.meta.json` schema version.
- **Phase 4 — OCR Lens:** a fully decoupled module that shares only the app shell and the client
  routing established here; it touches neither the session singleton nor the encrypted DB.

## Contracts Later Phases Depend On

These are the exports Phase 2+ will import. Changing their shape is a cross-phase break.

| Module | Exported contract |
|---|---|
| `server/src/modules/auth/crypto.ts` | `deriveMasterKey(password, salt) => Promise<Buffer>`, `wrapKey(plaintext, key) => WrappedBlob`, `unwrapKey(blob, key) => Buffer`, `KDF_PARAMS` |
| `server/src/modules/auth/session.ts` | `isUnlocked() => boolean`, `getDb() => Kysely<VaultDbSchema>`, `getVaultKey() => Buffer`, `unlockSession(key, db)`, `lock()`, `armIdleTimer()`, `IDLE_MS` |
| `server/src/modules/auth/vaultMeta.ts` | `VaultMeta` interface, `readVaultMeta()`, `writeVaultMetaAtomic(meta)`, `vaultExists()` |
| `server/src/modules/db/connection.ts` | `openVaultDb(path, vaultKey) => Kysely<VaultDbSchema>` |
| `server/src/modules/db/schema.ts` | `VaultDbSchema` interface — Phase 2 extends this with entry tables |
| `server/src/middleware/requireUnlocked.ts` | Express middleware gating every `/api/vault/*` route that needs an unlocked vault, and the single place `armIdleTimer()` is called |
