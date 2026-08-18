---
phase: 01-secure-vault-setup-unlock
fixed_at: 2026-08-18T20:53:30Z
review_path: .planning/phases/01-secure-vault-setup-unlock/01-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-08-18
**Source review:** .planning/phases/01-secure-vault-setup-unlock/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (1 critical, 7 warnings — `fix_scope: critical_warning`, IN-01 excluded)
- Fixed: 8
- Skipped: 0

**Verification:** Every fix ran in the isolated worktree
(`.claude/worktrees/rf-01-*`, cleaned up after the run) against the full
server test suite (`npx vitest run server/src`), `npm run typecheck`, and
`npm run lint`. Final state after all 8 commits: 53/53 server tests passing,
0 typecheck errors, 0 lint errors — reproducible from the main checkout,
since the worktree's commits were fast-forwarded onto `master` and the
worktree itself was removed as part of cleanup.

## Fixed Issues

### CR-01: `POST /api/vault/2fa/confirm` has no rate limiting — brute-forceable, and can silently attach an attacker-controlled second factor to a no-recovery vault

**Files modified:** `server/src/middleware/rateLimit.ts`, `server/src/modules/auth/routes.ts`, `server/src/modules/auth/two-factor-unlock.test.ts`, `client/src/lib/api.ts`, `client/src/features/vault-2fa/EnrollScreen.tsx`
**Commit:** `69ddb1e`
**Applied fix:** Closed both structural gaps identified in the finding, not just the rate limit:
1. Added `twoFactorConfirmRateLimit` (mirrors `unlockRateLimit`'s policy and `vaultAuthError()` forwarding) and mounted it on `POST /2fa/confirm`.
2. Made `POST /2fa/confirm` require a freshly re-submitted master password (via `reauthenticateWithMasterPassword`, the same helper `/2fa/disable` and `/2fa/backup-codes/regenerate` already use), closing the asymmetry the review called out as "the root cause that makes the missing rate limit exploitable at all." Every failure path (bad password, bad code, unknown/expired enrollment id) now collapses to the same `vaultAuthError()` response.
Updated the client (`api.ts`, `EnrollScreen.tsx`) to collect and submit the master password alongside the confirmation code, and extended `two-factor-unlock.test.ts` with a new test proving a wrong-password confirm attempt fails, leaves `totpEnabled: false`, and does not consume the pending enrollment (the correct password can still confirm it afterward).
No change was made to `totp.ts`'s `confirmEnrollment()` function itself — the reauth check lives at the route layer, so the module-level tests in `totp.test.ts` (which call `confirmEnrollment` directly) needed no changes.

### WR-01: `LockedNotice`'s "Unlock again" button mutates a ref and never re-renders

**Files modified:** `client/src/App.tsx`
**Commit:** `4206c7d`
**Applied fix:** Replaced `wasUnlockedRef` (a `useRef`) with `wasUnlocked` state (`useState`). The render-phase update that sets it (`if (status?.unlocked && !wasUnlocked) setWasUnlocked(true)`) is guarded so it only fires on the transition into "seen unlocked," avoiding a render loop. `onReturnToUnlock` now calls `setWasUnlocked(false)` directly, so clicking "Unlock again" re-renders immediately instead of waiting for the next poll/visibility event.

### WR-02: `deriveMasterKey`'s `hashLength`/`type` are always read from the live `config.KDF_PARAMS`, not from anything persisted per-vault

**Files modified:** `server/src/modules/auth/crypto.ts`, `server/src/modules/auth/routes.ts`, `server/src/modules/auth/vaultMeta.ts`, `server/src/types.ts`
**Commit:** `2fe14c1`
**Applied fix:** Added `hashLength` to `KdfCostParams` and `VaultMeta.kdf`, persisted it at vault creation (`config.KDF_PARAMS.hashLength`), and threaded it through both places that re-derive the Master Key on an existing vault (`POST /unlock` and `reauthenticateWithMasterPassword`). Also fixed a bug this surfaced during verification: `vaultMetaSchema` in `vaultMeta.ts` (a Zod schema) did not declare the new field, so `readVaultMeta()` silently stripped it back out on every read via Zod's default unknown-key behavior — added `hashLength: z.number()` to the schema so the persisted value actually round-trips. Verified against the full server suite (initially caught 17 failing tests from the stripped field before the schema fix; 0 after).

### WR-03: `session.lock()`'s fire-and-forget `db.destroy()` has no error handling, unlike every other call site

**Files modified:** `server/src/modules/auth/session.ts`
**Commit:** `97c96d0`
**Applied fix:** Applied the review's suggested fix directly: `db.destroy()` is now followed by `.catch(() => {})` instead of being a bare `void db.destroy()`, matching the try/catch pattern used at every other Kysely-handle-close call site in the codebase.

### WR-04: No CSRF/Origin protection on state-changing routes — loopback binding alone does not stop a same-browser malicious page

**Files modified:** `server/src/app.ts`, `server/src/app.test.ts`, `server/src/config.ts`, `server/src/middleware/sameOrigin.ts` (new)
**Commit:** `51236c1`
**Applied fix:** Added a new `requireSameOriginForMutations` middleware, mounted globally in `app.ts` before the vault router. It allows `GET`/`HEAD`/`OPTIONS` unconditionally, and for every other method requires the request's `Origin` header to be either absent (non-browser clients — curl, this project's own `fetch`-based test harness, neither of which ever sets one) or exactly `config.ALLOWED_ORIGIN` (the Vite dev server's origin, `http://127.0.0.1:5173` — the only legitimate same-origin caller in this project's current topology). Added `config.ALLOWED_ORIGIN` as the single source of truth for the expected origin. Added 4 new tests to `app.test.ts` covering: mismatched-Origin POST rejected with 403 and no vault created, no-Origin POST allowed through to route validation, matching-Origin POST allowed through, and GET never blocked regardless of Origin.

### WR-05: No rate limiting on `/2fa/disable` or `/2fa/backup-codes/regenerate` reauthentication

**Files modified:** `server/src/modules/auth/routes.ts`, `server/src/modules/auth/two-factor-unlock.test.ts`
**Commit:** `dc74d25`
**Applied fix:** Mounted the existing `unlockRateLimit` on both routes, exactly as the review's suggested code showed. Added a regression test proving 15 rapid wrong-password attempts against each route eventually produce the same generic `{ error: "Unable to unlock" }` response the rate-limited `/unlock` path already produces (mirroring the existing `unlock.test.ts` throttle test's structure).

### WR-06: TOCTOU / lost-update risk when consuming a backup code in `verifySecondFactor`

**Files modified:** `server/src/modules/auth/totp.ts`, `server/src/modules/auth/totp.test.ts`
**Commit:** `e2825f9`
**Applied fix:** `verifySecondFactor` now re-reads the sidecar (`readVaultMeta()`) immediately before matching and writing, instead of trusting the `meta` snapshot the `/unlock` handler captured before the ~474ms Argon2id derivation and the live-code check — both real await points a concurrent write can run inside. Since the fresh read and the subsequent `writeVaultMetaAtomic` call are both synchronous with no `await` between them, this closes the race by construction (nothing else can run on Node's single-threaded event loop between two synchronous statements) without introducing a separate lock/queue abstraction — consistent with how every other sidecar writer in this codebase is already structured (synchronous read-then-write, no intervening await). Added a regression test that captures a stale `meta` snapshot, simulates a concurrent backup-code regeneration in between, then proves a code from the pre-regeneration set is correctly rejected and the regenerated hash set survives untouched (previously, the stale-snapshot write would have silently reverted the regeneration).

### WR-07: Log redaction is a manually-maintained keyword blocklist with a real coverage gap

**Files modified:** `server/src/log.ts`, `server/src/log.test.ts`
**Commit:** `bb61c5b`
**Applied fix:** Took the review's first suggested option: broadened `SECRET_KEY_PATTERN` to include `uri`, `url`, `qr`, `blob`, `data`, so a future `qrDataUrl`-shaped field (a base64 PNG data URL encoding the full `otpauth://` URI, including the TOTP secret) is redacted even though its name doesn't match the original terms. Verified no existing log call site in the codebase (`host`, `port`, `method`, `path`, `isVaultAuthError`, `origin`) collides with the new terms. Added a regression test proving a `qrDataUrl` field is now redacted. IN-01 (unanchored substring matching causing over-redaction false positives) was left as-is — out of scope for this run (`fix_scope: critical_warning` excludes Info-tier findings).

## Skipped Issues

None — all 8 in-scope findings were fixed.

---

_Fixed: 2026-08-18_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
