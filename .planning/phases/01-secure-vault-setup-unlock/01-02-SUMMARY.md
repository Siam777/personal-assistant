---
phase: 01-secure-vault-setup-unlock
plan: 02
subsystem: auth-crypto
tags: [argon2, aes-256-gcm, better-sqlite3-multiple-ciphers, kysely, zxcvbn, express, react]

# Dependency graph
requires: ["01-01"]
provides:
  - "Real Argon2id KDF + AES-256-GCM envelope wrap/unwrap (server/src/modules/auth/crypto.ts)"
  - "vault.meta.json sidecar read/atomic-write + ensureVaultDir (server/src/modules/auth/vaultMeta.ts)"
  - "Keyed better-sqlite3-multiple-ciphers connection via Kysely + schema_version bootstrap (server/src/modules/db/connection.ts)"
  - "Real module-scoped session singleton: Vault Key custody, idle timer, synchronous lock() (server/src/modules/auth/session.ts)"
  - "POST /api/vault/init and real GET /api/vault/status (server/src/modules/auth/routes.ts)"
  - "First-run vault creation UI: InitScreen + non-dismissible NoRecoveryWarning (client/src/features/vault-unlock/)"
  - "Fixed scripts/dev.mjs fresh-checkout race (node --watch vs tsc --watch with no prior dist/)"
affects: ["01-03", "01-04"]

# Actuals (#2632)
actuals:
  tokens: 10388
  tasks: 1
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Envelope encryption: Argon2id(password, salt) -> Master Key -> AES-256-GCM-wraps a random 32-byte Vault Key -> Vault Key keys the whole-file-encrypted SQLite database"
    - "AES-256-GCM auth-tag mismatch (thrown by decipher.final()) is the sole password-correctness oracle — no separate PHC-string verifier anywhere in the codebase"
    - "ensureVaultDir() must run before both openVaultDb() and writeVaultMetaAtomic() — better-sqlite3-multiple-ciphers requires the parent directory to pre-exist"
    - "session.ts lock() zeroes the key buffer, destroys the db handle, and clears the timer in one synchronous function body with no early return"
    - "Mid-sequence POST /init failure removes any partially-written vault.db/vault.meta.json rather than leaving an unopenable vault behind"

key-files:
  created:
    - server/src/modules/auth/crypto.ts
    - server/src/modules/auth/crypto.test.ts
    - server/src/modules/auth/vaultMeta.ts
    - server/src/modules/auth/routes.ts
    - server/src/modules/auth/vault-init.test.ts
    - server/src/modules/db/connection.ts
    - client/src/features/vault-unlock/InitScreen.tsx
    - client/src/features/vault-unlock/NoRecoveryWarning.tsx
  modified:
    - server/src/app.ts
    - server/src/modules/auth/session.ts
    - client/src/App.tsx
    - client/src/lib/api.ts
    - client/package.json
    - scripts/dev.mjs
    - package-lock.json

key-decisions:
  - "Task 1 (vault on-disk format) decided as-planned in a prior session: sqlcipher whole-DB cipher mode, two-file vault layout (vault.db + unencrypted vault.meta.json sidecar), AES-256-GCM auth-tag as the sole password-correctness oracle. No difference from the plan's default, so 01-SKELETON.md's architectural-decision table is unchanged."
  - "Added @zxcvbn-ts/core + language-common/language-en to client/package.json (already vetted in Task 1's checkpoint for the server workspace) so InitScreen can compute a live client-side strength meter, as the plan's action explicitly requires"

patterns-established:
  - "PRAGMA cipher -> .key(Buffer) -> forcing read (user_version) ordering, verified by line-number grep in the acceptance criteria"
  - "vault.meta.json written via temp-file -> fsync -> atomic rename, never a direct overwrite"

requirements-completed: [SEC-01, SEC-05]

coverage:
  - id: D1
    description: "A first-run user can submit a master password in the browser and the app creates a vault: vault.meta.json and vault.db both exist on disk afterwards"
    requirement: "SEC-01"
    verification:
      - kind: integration
        ref: "server/src/modules/auth/vault-init.test.ts — asserts both files exist after a 201 response"
        status: pass
      - kind: manual_procedural
        ref: "Live npm run dev + curl through the Vite proxy (127.0.0.1:5173) — 201 response, .vault/vault.db and .vault/vault.meta.json created on disk"
        status: pass
    human_judgment: false
  - id: D2
    description: "Vault creation is refused unless the user has explicitly acknowledged there is no password recovery"
    requirement: "SEC-01"
    verification:
      - kind: integration
        ref: "vault-init.test.ts — missing/false noRecoveryAcknowledged both return 400, create no files"
        status: pass
    human_judgment: false
  - id: D3
    description: "Vault creation is refused for empty/whitespace-only/weak passwords, no file created"
    requirement: "SEC-01"
    verification:
      - kind: integration
        ref: "vault-init.test.ts — empty password and a common-dictionary password (\"password\", zxcvbn score 0) both return 400 with no files created"
        status: pass
      - kind: manual_procedural
        ref: "Live curl through the proxy with masterPassword: \"password\" -> 400 { error, score: 0, feedback: \"This is a heavily used password.\" }"
        status: pass
    human_judgment: false
  - id: D4
    description: "vault.db cannot be opened and read as SQLite without the derived Vault Key"
    requirement: "SEC-01"
    verification:
      - kind: integration
        ref: "vault-init.test.ts — unkeyed better-sqlite3-multiple-ciphers open + pragma('user_version') throws; first 16 bytes are not the plaintext SQLite header magic"
        status: pass
      - kind: manual_procedural
        ref: "Live inspection: first 16 bytes of .vault/vault.db are random-looking ciphertext, not \"SQLite format 3\\0\""
        status: pass
    human_judgment: false
  - id: D5
    description: "vault.meta.json contains no plaintext master password, derived key, or secret — only ciphertext/IVs/tags/salt/non-secret KDF params"
    requirement: "SEC-05"
    verification:
      - kind: integration
        ref: "vault-init.test.ts — raw sidecar bytes scanned for the test password in both UTF-8 and base64 form, neither found"
        status: pass
      - kind: manual_procedural
        ref: "Live cat of .vault/vault.meta.json — only version/createdAt/cipher/kdf-params/salt/wrappedVaultKey ciphertext blobs/totp defaults, no plaintext secret"
        status: pass
    human_judgment: false
  - id: D6
    description: "A row written to schema_version at creation is read back through the same keyed Kysely connection, proving the encrypted DB round-trips"
    requirement: "SEC-01"
    verification:
      - kind: integration
        ref: "vault-init.test.ts — independently re-derives the Vault Key from the sidecar + password, reopens the DB via openVaultDb, and reads schema_version.version === 1"
        status: pass
    human_judgment: false
  - id: D7
    description: "After creation the app reports initialized+unlocked, and the Vault Key exists only as a Buffer in the Node process — never in a response body, file, or browser storage"
    requirement: ["SEC-01", "SEC-05"]
    verification:
      - kind: integration
        ref: "vault-init.test.ts — response body toEqual'd against exactly the four VaultStatus fields, no extra field, no base64 blob"
        status: pass
      - kind: other
        ref: "grep -rnE \"(localStorage|sessionStorage)\" client/src --include=*.ts --include=*.tsx | wc -l -> 0"
        status: pass
    human_judgment: false
  - id: D8
    description: "A second vault-creation attempt against an existing vault is refused without touching the existing files"
    requirement: "SEC-01"
    verification:
      - kind: integration
        ref: "vault-init.test.ts — second POST /init returns 409; vault.meta.json and vault.db byte-compared identical before/after"
        status: pass
      - kind: manual_procedural
        ref: "Live curl second POST /init -> 409"
        status: pass
    human_judgment: false
  - id: D9
    description: "No-recovery warning is non-dismissible and prominent; strong password required; browser autofill/Web Storage never capture the master password"
    requirement: "SEC-01"
    verification:
      - kind: other
        ref: "grep -ricE \"(dismiss|onClose|skip)\" NoRecoveryWarning.tsx -> 0; literal warning sentence present; grep -c autoComplete=\"new-password\" InitScreen.tsx -> 2"
        status: pass
      - kind: manual_procedural
        ref: "Visual confirmation of the rendered warning/disabled-submit-button behavior, and DevTools Application-tab Local/Session Storage inspection, requires an actual browser session"
        status: unknown
    human_judgment: true
    rationale: "All server-side and structural client-side checks (grep, response shape, no Web Storage API reference anywhere in client/src) pass and were run live against the real dev server and Vite proxy. The purely visual/interactive pieces — the warning rendering as an unmissable blocking panel, the submit button staying disabled until all three gate conditions are met, and confirming no browser 'save password' prompt or DevTools Local/Session Storage entry appears — require an actual browser session this headless execution environment cannot drive. Per this project's human_verify_mode: end-of-phase config, this is flagged for a human pass rather than blocking the plan, consistent with how Plan 01-01 handled its own unverifiable interactive item (Ctrl-C shutdown, D6)."

duration: 45min
completed: 2026-08-18
status: complete
---

# Phase 1 Plan 2: Vault Creation Tracer — Real Encryption End-to-End Summary

**Argon2id + AES-256-GCM envelope encryption, a whole-file-encrypted SQLite vault via better-sqlite3-multiple-ciphers/Kysely, and a first-run browser UI — one real path wired through every layer, verified both by an automated test suite and a live `npm run dev` run.**

## Performance

- **Duration:** ~45 min (this execution; Task 1's decision was pre-approved in a prior attempt whose worktree was reclaimed before Task 2 ran)
- **Tasks:** 1 executed here (Task 2, the tracer). Task 1 (`checkpoint:decision`, vault on-disk format) was already presented to and decided by the user before this run — selected "as-planned" (sqlcipher cipher mode, two-file sidecar layout, AES-256-GCM auth-tag oracle) — and is not re-litigated.
- **Files changed:** 15 (7 new source files, 2 new test files, 6 modified)
- **Commits:** 1 task commit (`a208cb9`)

## Accomplishments

- `server/src/modules/auth/crypto.ts`: `deriveMasterKey` (Argon2id raw-mode, calibrated `KDF_PARAMS` from Plan 01-01), `wrapKey`/`unwrapKey` (AES-256-GCM, fresh CSPRNG IV every call), `generateVaultKey`. No PHC-string verifier anywhere — the GCM auth-tag mismatch is the sole password-correctness oracle.
- `server/src/modules/auth/vaultMeta.ts`: zod-validated `readVaultMeta`, atomic temp-file-then-rename `writeVaultMetaAtomic`, `vaultExists`, and `ensureVaultDir` (mode `0o700`).
- `server/src/modules/db/connection.ts`: `openVaultDb` in the load-bearing order (open -> `pragma('cipher=sqlcipher')` -> `.key(Buffer)` -> forcing `pragma('user_version')` read, converting a wrong-key failure into `vaultAuthError()`) and `initSchema` for the `schema_version` table.
- `server/src/modules/auth/session.ts`: replaced the Plan 01-01 stub with the real module-scoped singleton — `unlockSession`, `isUnlocked`, `getVaultKey`/`getDb` (throw when locked), `armIdleTimer`, and `lock()` (zero key, destroy db handle, clear timer, all in one synchronous body with no early return).
- `server/src/modules/auth/routes.ts`: real `GET /status` (no auth gate — the client polls it, polling must never keep a session alive) and `POST /init` (409 exists -> 400 empty password -> 400 weak password with zxcvbn `score`/`feedback` -> derive/wrap/open-db/init-schema/round-trip-read/write-sidecar/unlock-session -> 201), with cleanup of any partially-created `vault.db`/`vault.meta.json` on a mid-sequence failure.
- `client/src/features/vault-unlock/`: `InitScreen.tsx` (double password entry with match check, live client-side `@zxcvbn-ts/core` strength meter, `autoComplete="new-password"` on both fields, disabled submit until match+strength+acknowledgement) and `NoRecoveryWarning.tsx` (the literal required sentence, a labelled checkbox, no dismiss/close/skip affordance anywhere).
- `client/src/App.tsx` now routes on vault status: loading -> error -> `InitScreen` (not initialized) -> unlocked placeholder (Plan 01-03 replaces it).
- `server/src/modules/auth/vault-init.test.ts` + `crypto.test.ts`: 9 tests proving the encrypted round trip, no plaintext leakage, IV freshness, KDF determinism, and the 409/400 refusal paths — all against a real Express app instance per test (fresh, non-pre-created `VAULT_DIR`).

## Task Commits

1. **Task 2: End-to-end tracer — a user creates a vault and it is really encrypted** - `a208cb9` (feat)

**Plan metadata:** commit for SUMMARY.md is created by the orchestrator after all wave agents complete (worktree mode — this executor does not write STATE.md/ROADMAP.md).

## Files Created/Modified

- `server/src/modules/auth/crypto.ts` / `crypto.test.ts` — Argon2id KDF + AES-256-GCM wrap/unwrap, and its round-trip/IV-freshness/determinism test suite
- `server/src/modules/auth/vaultMeta.ts` — sidecar read/atomic-write/`ensureVaultDir`
- `server/src/modules/db/connection.ts` — keyed connection open + schema bootstrap
- `server/src/modules/auth/session.ts` — real singleton (replaces Plan 01-01 stub)
- `server/src/modules/auth/routes.ts` — `POST /init`, real `GET /status`
- `server/src/modules/auth/vault-init.test.ts` — the tracer's end-to-end proof
- `server/src/app.ts` — mounts `vaultRouter` at `/api/vault`, replacing the Plan 01-01 placeholder
- `client/src/features/vault-unlock/InitScreen.tsx` / `NoRecoveryWarning.tsx` — first-run creation UI
- `client/src/App.tsx` — becomes the status-driven router
- `client/src/lib/api.ts` — `initVault`, `WeakPasswordError`
- `client/package.json` — adds `@zxcvbn-ts/*` for the client-side strength meter
- `scripts/dev.mjs` — fixed the fresh-checkout race (see Deviations)

## Decisions Made

- Task 1's vault-format checkpoint was decided **as-planned** (sqlcipher cipher mode, two-file sidecar layout, AES-256-GCM auth-tag oracle) by the user in a prior session; this run implemented exactly that format with no deviation, so `01-SKELETON.md`'s architectural-decision table required no update per the plan's own output instruction.
- Added `@zxcvbn-ts/core` + `@zxcvbn-ts/language-common` + `@zxcvbn-ts/language-en` to `client/package.json`. These are the same scoped packages Task 1's package-legitimacy checkpoint already vetted for the server workspace; the plan's action explicitly requires a live client-side strength meter, which needs the same library in the client bundle.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `scripts/dev.mjs` killed the whole process tree on a truly fresh checkout**
- **Found during:** Live `npm run dev` verification of the plan's `<human-check>` step, with no prior `server/dist/` present
- **Issue:** `dev.mjs` spawned `tsc --watch` and `node --watch server/dist/src/app.js` concurrently. On a fresh checkout `dist/` doesn't exist yet, so `node --watch`'s first load throws `MODULE_NOT_FOUND` before `tsc`'s first compile lands. The child's `exit` handler treats any child exit as fatal and calls `shutdownAll()`, killing `tsc` and the Vite client process too — the documented "one command runs the whole stack" contract was broken on a genuinely fresh checkout, which is exactly the scenario the plan's human-check step exercises.
- **Fix:** Added a synchronous one-shot `tsc -p server/tsconfig.json` build (`spawnSync`) before spawning the three watcher children, guaranteeing `server/dist/src/app.js` exists before `node --watch` starts.
- **Files modified:** `scripts/dev.mjs`
- **Verification:** Removed `server/dist/`, re-ran `npm run dev` — `[build] compiling server once...` -> `Found 0 errors` -> all three watchers came up cleanly, server listening on `127.0.0.1:5174`, client on `127.0.0.1:5173`.
- **Committed in:** `a208cb9`

**2. [Rule 1 - Bug] `openVaultDb()` ran before `.vault/` existed**
- **Found during:** The same live `npm run dev` verification — `POST /api/vault/init` with a strong password returned `500 { error: "Internal error" }`
- **Issue:** `routes.ts`'s `POST /init` called `openVaultDb(config.VAULT_DB_PATH, vaultKey)` before `writeVaultMetaAtomic` (which was the only place creating `config.VAULT_DIR`). `better-sqlite3-multiple-ciphers`'s `new Database(path)` throws `Cannot open database because the directory does not exist` when the parent directory is absent — confirmed via a standalone reproduction script calling the same exported functions directly.
- **Why the automated test suite didn't catch it:** `vault-init.test.ts`'s harness used `mkdtempSync()` for its per-test `VAULT_DIR`, which *creates* the directory as a side effect — masking the exact bug a genuinely fresh checkout hits, where `.vault/` doesn't exist at all.
- **Fix:** Extracted `ensureVaultDir()` in `vaultMeta.ts` (used by both `writeVaultMetaAtomic` and now called explicitly in `routes.ts` before `openVaultDb`). Also fixed the test harness to build a temp path via `path.join(os.tmpdir(), ...)` without pre-creating it, so the suite now exercises the real fresh-checkout condition.
- **Files modified:** `server/src/modules/auth/vaultMeta.ts`, `server/src/modules/auth/routes.ts`, `server/src/modules/auth/vault-init.test.ts`
- **Verification:** Re-ran the full test suite (still 20/20 passing, now against a non-pre-created directory) and the live `npm run dev` flow — `POST /init` returned `201`, both vault files created, second `POST /init` returned `409` untouched.
- **Committed in:** `a208cb9`

**3. [Rule 1 - Bug] Two doc comments accidentally self-collided with their own acceptance-criteria greps**
- **Found during:** Running the plan's own acceptance-criteria greps after initial implementation
- **Issue:** `crypto.ts`'s doc comment used the literal string `argon2.verify()` to describe what NOT to call, colliding with `grep -rn "argon2.verify" server/src` (required to output `0`). `NoRecoveryWarning.tsx`'s doc comment used "dismiss"/"skip" descriptively, colliding with `grep -ricE "(dismiss|onClose|skip)"` (required to output `0`).
- **Fix:** Reworded both comments to describe the same intent without using the literal grepped substrings (mirrors the pattern Plan 01-01 used for its own wildcard-host grep collision).
- **Files modified:** `server/src/modules/auth/crypto.ts`, `client/src/features/vault-unlock/NoRecoveryWarning.tsx`
- **Verification:** Both greps now output `0`.
- **Committed in:** `a208cb9`

**4. [Rule 3 - Blocking] `vault-init.test.ts`'s full end-to-end test exceeded vitest's 5000ms default timeout**
- **Found during:** First `npm run test:server` run
- **Issue:** The test performs two full Argon2id derivations (once inside the route's `POST /init`, once independently in the test to verify the round-trip) at the calibrated ~474ms measured cost each, plus module-reset/native-module-reload overhead from the per-test `vi.resetModules()` + dynamic-import harness — comfortably exceeding the default 5000ms.
- **Fix:** Set an explicit 20000ms timeout on that one test via vitest's third `it()` argument.
- **Files modified:** `server/src/modules/auth/vault-init.test.ts`
- **Verification:** Test now passes consistently in ~3.5-4s, well under the new timeout.
- **Committed in:** `a208cb9`

---

**Total deviations:** 4 auto-fixed (2 real bugs caught only by live verification beyond the automated test suite, 2 self-colliding doc-comment/grep fixes, 1 test-timeout tuning).
**Impact on plan:** All four were required to make the plan's own `<verify>` and acceptance criteria genuinely pass — the two Rule 1 bugs were both silently masked by the automated test suite's own harness conveniences and would have shipped broken if the live `npm run dev` verification step had been skipped. No architecture, scope, or dependency changes.

## Known Stubs

- `client/src/App.tsx` (line 63): the unlocked-and-initialized branch renders a placeholder panel ("Vault unlocked. (The real unlocked view lands in Plan 01-03.)") rather than a real unlocked vault view. This is explicitly sanctioned by the plan's own action text ("render an unlocked placeholder panel when initialized and unlocked. Plan 01-03 replaces that placeholder with the real unlock and locked-state screens") and is not a hidden gap. Logged to `.planning/WINDOWS.md` for visibility at ship time.

## Issues Encountered

- The plan's human-check step ("Run `npm run dev` in a fresh checkout... confirm the no-recovery warning is prominent... the browser offers no 'save password' prompt... DevTools -> Application shows nothing under Local Storage or Session Storage") requires an actual interactive browser session, which this headless execution environment cannot drive. All server-side and structural checks were run live against the real dev server (curl through the Vite proxy at `127.0.0.1:5173`, direct hits to the Express server at `127.0.0.1:5174`, raw byte inspection of `.vault/vault.db` and `.vault/vault.meta.json`) and all passed. The purely visual/interactive pieces are flagged as `human_judgment: true` in the `coverage` block (D9) rather than blocking the plan, consistent with this project's `human_verify_mode: end-of-phase` config and the pattern Plan 01-01 established for its own unverifiable interactive item.

## User Setup Required

None — no external service configuration required. A human should do one final interactive pass in a real browser per the Issues Encountered note above (D9) before end-of-phase sign-off.

## Next Phase Readiness

- All contracts from `01-SKELETON.md`'s "Contracts Later Phases Depend On" table are implemented and committed: `crypto.ts` (`deriveMasterKey`, `wrapKey`, `unwrapKey`, `generateVaultKey`), `session.ts` (`isUnlocked`, `getDb`, `getVaultKey`, `unlockSession`, `lock`, `armIdleTimer`), `vaultMeta.ts` (`VaultMeta`, `readVaultMeta`, `writeVaultMetaAtomic`, `vaultExists`, plus the new `ensureVaultDir`), `connection.ts` (`openVaultDb`).
- Plan 01-03 (unlock flow) can build directly on `session.ts`'s real singleton and `vaultMeta.ts`'s real sidecar — no further scaffolding needed on the crypto/session/db layers.
- `scripts/dev.mjs` now reliably brings up the full stack on a genuinely fresh checkout (verified live), which Plan 01-03/01-04's own human-check steps will depend on.
- One item for human follow-up before phase sign-off: the visual/interactive portion of Task 2's `<human-check>` (D9 in `coverage`) — warning-panel prominence, submit-button gating, and DevTools Local/Session Storage inspection in a real browser.

## Self-Check: PASSED

- FOUND: server/src/modules/auth/crypto.ts
- FOUND: server/src/modules/auth/vaultMeta.ts
- FOUND: server/src/modules/db/connection.ts
- FOUND: server/src/modules/auth/routes.ts
- FOUND: client/src/features/vault-unlock/InitScreen.tsx
- FOUND: client/src/features/vault-unlock/NoRecoveryWarning.tsx
- FOUND commit: a208cb9 (feat tracer)

---
*Phase: 01-secure-vault-setup-unlock*
*Completed: 2026-08-18*
