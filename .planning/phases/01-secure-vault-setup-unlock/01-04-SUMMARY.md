---
phase: 01-secure-vault-setup-unlock
plan: 04
subsystem: auth-crypto
tags: [otplib, qrcode, aes-256-gcm, sha-256, vitest-fake-timers, express, react]

# Dependency graph
requires:
  - phase: 01-03
    provides: "POST /api/vault/unlock accepting { masterPassword, totpCode? } and branching (fail-closed) on meta.totp.enabled; GET /status reporting totpEnabled; UnlockScreen already rendering the second-factor field from the totpEnabled status flag"
provides:
  - "totp.ts — beginEnrollment/confirmEnrollment/verifySecondFactor/generateBackupCodes/disableTotp, wrapping the TOTP secret with the Vault Key (never the Master Key) and hashing backup codes with SHA-256"
  - "Four routes under /api/vault/2fa/* (enroll, confirm, disable, backup-codes/regenerate), all requireUnlocked; disable/regenerate additionally re-derive the Master Key from a freshly submitted password"
  - "The unlock handler's second-factor branch completed: verifySecondFactor is handed the already-recovered Vault Key, never derives one itself, so a code alone structurally cannot unlock anything"
  - "client/src/features/vault-2fa/ — EnrollScreen, BackupCodesPanel, DisableWithReauthScreen, TwoFactorSettings, wired into App.tsx behind the unlocked view"
  - "two-factor-unlock.test.ts — ten assertions proving both factors are required, all failure responses are byte-identical, and the sidecar never holds the secret or backup codes in plaintext"
affects: []

# Actuals (#2632)
actuals:
  tokens: 15232
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "verifySecondFactor(code, vaultKey, meta) takes the Vault Key as a parameter rather than deriving one — the caller (the unlock handler) can only have that key by having already proven the master password via unwrapKey's auth-tag check, which is what makes the second factor structurally additive rather than substitutive, not merely additive by convention"
    - "otplib's verify()/its guardrails throw (TokenLengthError) on malformed input rather than returning an invalid result — both call sites in totp.ts wrap verify() in try/catch and treat a throw identically to result.valid === false, so a backup code (wrong length/format for a TOTP token) still falls through to the backup-code check instead of crashing the request"
    - "A pending TOTP enrollment lives only in an in-memory Map keyed by a random id with a short TTL — never written to the sidecar until a valid confirmation code commits it, so an abandoned enrollment (scanned, never confirmed) leaves the vault's on-disk state completely unchanged"
    - "Backup codes are generated from randomBytes rendered through a 32-character alphabet (excludes 0/O/1/I/L); 32 divides 256 evenly so byte % 32 has zero modulo bias"
    - "Backup-code matching uses Buffer.from(hex).length-check + timingSafeEqual per candidate rather than string equality, defense-in-depth consistent with this phase's other secret comparisons even though the codes are already single-use and high-entropy"

key-files:
  created:
    - server/src/modules/auth/totp.ts
    - server/src/modules/auth/totp.test.ts
    - server/src/modules/auth/two-factor-unlock.test.ts
    - client/src/features/vault-2fa/EnrollScreen.tsx
    - client/src/features/vault-2fa/BackupCodesPanel.tsx
    - client/src/features/vault-2fa/DisableWithReauthScreen.tsx
    - client/src/features/vault-2fa/TwoFactorSettings.tsx
  modified:
    - server/src/modules/auth/routes.ts
    - server/src/types.ts
    - client/src/lib/api.ts
    - client/src/App.tsx
    - client/src/features/vault-unlock/UnlockScreen.tsx

key-decisions:
  - "Enrollment re-authentication reading (Task 1's flagged assumption #7, third item): first-time enrollment requires only an unlocked session, NOT a freshly re-submitted master password. Disable and backup-code regeneration DO require it. This follows the plan's own explicit reading of D-06, which names view/reset/disable as the re-authentication cases and does not name initial enrollment. Not changed silently — flagged here per the plan's own instruction, since it is the one place this phase interprets D-06 rather than quoting it, and remains the item most worth a second opinion."
  - "otplib's verify() throws (TokenLengthError) rather than returning an invalid result when the supplied token doesn't match the expected TOTP format (e.g. a backup code's length). Both totp.ts call sites (confirmEnrollment, verifySecondFactor) now wrap the verify() call in try/catch and treat any throw as equivalent to result.valid === false — otherwise a backup-code attempt against the live-code check would 500 instead of falling through to the backup-code path. Root-caused by the totp.test.ts backup-code test failing with 'Token must be 6 digits, got 9' on first run; fixed under deviation Rule 1 (bug in the interaction between two otherwise-correct pieces)."
  - "The client's unlocked view gained a minimal state-driven switch (UnlockedView: 'vault' | 'settings') rather than a routing library — App.tsx has no router dependency yet, and TwoFactorSettings is reachable only from inside the status.unlocked branch, so there is no code path that reaches it while locked."

patterns-established:
  - "A library call that can throw on malformed input, where the calling code's contract requires a plain boolean/null result with no distinguishable failure modes, gets wrapped in try/catch at the call site rather than validated upstream — validating token format before calling verify() would itself become a second place 'is this a valid code shape' logic lives, and would still need to handle the case where a future otplib version's guardrails change what they reject."

requirements-completed: [SEC-03, SEC-05]

coverage:
  - id: D1
    description: "A user with an unlocked vault can enable TOTP 2FA from settings, scan a QR code with an authenticator app, and confirm enrollment by entering a code the app generates"
    requirement: "SEC-03"
    verification:
      - kind: integration
        ref: "server/src/modules/auth/totp.test.ts — 'confirms enrollment with a code generated for the enrolled secret, and returns ten backup codes' (uses otplib to generate a code from the returned secret, same algorithm a real authenticator app implements)"
        status: pass
    human_judgment: true
    rationale: "Scanning a QR code with a real authenticator app (Google Authenticator/Authy) and visually confirming the settings UI flow requires an interactive browser session this headless execution environment cannot drive — deferred to end-of-phase human verification per this project's human_verify_mode: end-of-phase config. No developer feedback on a low-backup-codes warning was requested since no interactive human check occurred yet."
  - id: D2
    description: "Enrollment is not committed until the user proves they can generate a valid code — a scanned-but-unconfirmed secret is never persisted"
    requirement: "SEC-03"
    verification:
      - kind: unit
        ref: "totp.test.ts — 'rejects confirmation with a code generated from a different secret — proving .valid is read explicitly' (asserts meta.totp.enabled stays false and wrappedSecret stays null)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Enrollment shows ten single-use backup codes exactly once, and they cannot be retrieved again afterwards"
    requirement: "SEC-03"
    verification:
      - kind: unit
        ref: "totp.test.ts — 'confirms enrollment...returns ten backup codes' (ten distinct codes returned exactly once); grep -ricE '(dismiss|onClose|skip)' BackupCodesPanel.tsx -> 0, no bypass affordance in the component"
        status: pass
    human_judgment: true
    rationale: "The server-side guarantee (codes never re-servable by any endpoint) is proven by test and by the route inventory, but visually confirming the UI's one-time-display discipline (copy/download controls, mandatory acknowledgement gating Continue, no path back to the codes after continuing) requires an interactive browser session — part of the same deferred human check as D1."
  - id: D4
    description: "Once 2FA is enabled, unlocking requires both the correct master password and a valid TOTP code submitted together in one request"
    requirement: "SEC-03"
    verification:
      - kind: integration
        ref: "server/src/modules/auth/two-factor-unlock.test.ts — 'the correct master password with a valid current code unlocks the vault'"
        status: pass
    human_judgment: false
  - id: D5
    description: "A valid TOTP code alone never unlocks the vault, and enabling 2FA introduces no unlock path that skips master-password verification"
    requirement: "SEC-03"
    verification:
      - kind: integration
        ref: "two-factor-unlock.test.ts — 'an incorrect master password with a valid current code fails — the second factor cannot substitute for the first'"
        status: pass
      - kind: other
        ref: "routes.ts: unwrapKey's call site precedes verifySecondFactor's call site (line 241 vs 253); verifySecondFactor's own signature takes vaultKey as a parameter and never derives one — grep -c deriveMasterKey totp.ts -> 0"
        status: pass
    human_judgment: false
  - id: D6
    description: "An unused backup code unlocks the vault once and is consumed; the same code fails on a second use"
    requirement: "SEC-03"
    verification:
      - kind: integration
        ref: "two-factor-unlock.test.ts — 'an unused backup code plus the correct master password unlocks once; the same code fails immediately afterward; a different unused code still works'"
        status: pass
      - kind: unit
        ref: "totp.test.ts — 'verifySecondFactor accepts a backup code once and rejects it on reuse, and the sidecar loses exactly one hash'"
        status: pass
    human_judgment: false
  - id: D7
    description: "Every 2FA-related unlock failure returns the same generic response as a wrong master password, so no response reveals which factor failed"
    requirement: "SEC-03"
    verification:
      - kind: integration
        ref: "two-factor-unlock.test.ts — 'the missing-code, wrong-code, and wrong-password responses are byte-identical to each other and to a single-factor vault's wrong-password response' (assertion 5; compared against a freshly created single-factor-only vault in the same test, not just against itself)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The TOTP secret is stored encrypted with the Vault Key at the same standard as vault secrets — it never appears in plaintext in vault.meta.json"
    requirement: "SEC-05"
    verification:
      - kind: unit
        ref: "totp.test.ts — 'the sidecar's raw bytes never contain the base32 secret, in text or base64 form, after a confirmed enrollment'"
        status: pass
      - kind: integration
        ref: "two-factor-unlock.test.ts — 'the sidecar's raw bytes contain neither the base32 secret nor any plaintext backup code, in any encoding'"
        status: pass
    human_judgment: false
  - id: D9
    description: "Backup codes are stored only as SHA-256 digests; the plaintext codes exist only in the single enrollment response"
    requirement: "SEC-05"
    verification:
      - kind: unit
        ref: "totp.test.ts — 'generateBackupCodes returns ten distinct codes whose SHA-256 digests match the returned hashes'"
        status: pass
      - kind: integration
        ref: "two-factor-unlock.test.ts — sidecar byte scan (same test as D8) covers every returned backup code, not just the secret"
        status: pass
    human_judgment: false
  - id: D10
    description: "Disabling 2FA or regenerating backup codes requires re-entering the master password even though the vault is already unlocked"
    requirement: "SEC-03"
    verification:
      - kind: integration
        ref: "two-factor-unlock.test.ts — 'disabling 2FA with the correct master password returns the vault to single-factor unlock; an incorrect password fails and leaves 2FA on'"
        status: pass
      - kind: other
        ref: "grep -rn masterPassword server/src/modules/auth/routes.ts -> 15 matches across init/unlock/disable/regenerate handlers and their reauthenticateWithMasterPassword helper"
        status: pass
    human_judgment: false

duration: ~40min
completed: 2026-08-18
status: complete
---

# Phase 1 Plan 4: TOTP Second Factor Summary

**Optional TOTP 2FA layered on top of the master password via otplib + qrcode, with a confirm-before-commit enrollment flow, ten SHA-256-hashed single-use backup codes, and structural (not conditional) proof that a code alone can never unlock the vault.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 3
- **Files modified:** 12 (7 created, 5 modified)

## Accomplishments

- `totp.ts` server module: `beginEnrollment`, `confirmEnrollment`, `verifySecondFactor`, `generateBackupCodes`, `disableTotp` — the secret is wrapped with the Vault Key using the same AES-256-GCM helper every other vault secret uses, never a separately-derived key
- Four `/api/vault/2fa/*` routes, and the Plan 01-03 unlock handler's second-factor branch completed: the ordering (master password proven via `unwrapKey` before the second factor is ever examined) is structural, because `verifySecondFactor` is handed the already-recovered Vault Key rather than deriving one itself
- Full client surface: `EnrollScreen` (QR + manual-entry secret, confirm-before-commit), `BackupCodesPanel` (one-time display, no dismiss/skip affordance), `DisableWithReauthScreen` (shared master-password gate for disable and regenerate), `TwoFactorSettings` (state-driven router wired into `App.tsx`), and `UnlockScreen`'s second-factor field widened to also accept a backup code
- `two-factor-unlock.test.ts`: ten assertions, all passing on first run after the Task 1 fix below — including the byte-identity proof compared against a freshly created single-factor vault (not just against itself), and a fake-`Date` proof that a code past its tolerance window is rejected without waiting real time

## Task Commits

Each task was committed atomically:

1. **Task 1: TOTP enrollment, verification, and single-use backup codes** - `0d9ca5b` (feat)
2. **Task 2: 2FA enrollment, backup-code, and disable screens** - `1c48ff8` (feat)
3. **Task 3: Prove both factors are required and neither alone suffices** - `c8bc77b` (test)

**Plan metadata:** *(this commit)* (docs: complete plan)

## Files Created/Modified

- `server/src/modules/auth/totp.ts` - Enrollment, verification, backup-code generation/consumption, disable
- `server/src/modules/auth/totp.test.ts` - Unit proof: verify-result-object gotcha, backup-code hashing/single-use, sidecar byte scan
- `server/src/modules/auth/two-factor-unlock.test.ts` - End-to-end proof both factors are required
- `server/src/modules/auth/routes.ts` - Four `/2fa/*` routes, `reauthenticateWithMasterPassword` helper, completed unlock-handler branch
- `server/src/types.ts` - `EnrollmentStart` / `EnrollmentResult` type contracts
- `client/src/features/vault-2fa/EnrollScreen.tsx` - QR display and enrollment confirmation
- `client/src/features/vault-2fa/BackupCodesPanel.tsx` - One-time backup-code display
- `client/src/features/vault-2fa/DisableWithReauthScreen.tsx` - Master-password re-auth for disable/regenerate
- `client/src/features/vault-2fa/TwoFactorSettings.tsx` - State-driven router between the above
- `client/src/lib/api.ts` - Four typed 2FA client calls
- `client/src/App.tsx` - Settings view reachable only when unlocked
- `client/src/features/vault-unlock/UnlockScreen.tsx` - Helper text + widened input for a backup code

## Decisions Made

- Enrollment re-authentication reading: first-time enrollment requires only an unlocked session (not the master password again); disable and backup-code regeneration require it. This follows the plan's explicit reading of D-06 (Task 1's action text and `<flagged_assumptions>` #7) — recorded here per the plan's own instruction as the item most worth a second opinion, not changed silently.
- otplib's `verify()` throws (`TokenLengthError`) rather than returning an invalid result on malformed token input (e.g. a 9-character backup code where a 6-digit TOTP token is expected). Both call sites in `totp.ts` now wrap `verify()` in try/catch, treating any throw identically to `result.valid === false` — see Deviations below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] otplib's `verify()` throws on malformed token input instead of returning an invalid result**
- **Found during:** Task 1, running `totp.test.ts`'s backup-code test for the first time
- **Issue:** `verifySecondFactor`'s live-TOTP-code check calls `otplib.verify({ secret, token: code, ... })` unconditionally before falling through to the backup-code check. A backup code (format `XXXX-XXXX`, 9 characters) does not match otplib's expected 6-digit token shape, and otplib's internal guardrails throw `TokenLengthError` rather than returning `{ valid: false }`. The uncaught throw propagated out of `verifySecondFactor`, failing the test with `Token must be 6 digits, got 9` instead of falling through to the backup-code comparison as designed.
- **Fix:** Wrapped both `verify()` call sites in `totp.ts` (`confirmEnrollment` and `verifySecondFactor`) in try/catch, treating any thrown error identically to a `{ valid: false }` result. This preserves the function's documented contract — a plain boolean/null return, never a thrown exception a caller could use to distinguish failure causes — and lets a backup-code attempt correctly fall through to the backup-code path instead of crashing the request.
- **Files modified:** `server/src/modules/auth/totp.ts`
- **Verification:** `totp.test.ts`'s backup-code test passes; full `npm run test` (45/45) passes, including `two-factor-unlock.test.ts`'s backup-code assertion.
- **Committed in:** `0d9ca5b` (Task 1 commit — caught and fixed before the commit was made, so no separate fix commit was needed)

**2. [Rule 3 - Blocking, environment only] npm install required native-module approval and rebuild in this worktree**
- **Found during:** Setup, before Task 1
- **Issue:** No `node_modules` existed in this freshly created worktree. `npm install` flagged `argon2`, `better-sqlite3-multiple-ciphers`, and `esbuild` as packages with unapproved install scripts (this repo's package-manager policy), and the installed Node (24.19.0) differs from the native binaries' build-time ABI.
- **Fix:** Ran `npm approve-scripts argon2 better-sqlite3-multiple-ciphers esbuild` (all three are the same already-audited packages from this phase's own Package Legitimacy Audit in `01-RESEARCH.md`, not new dependencies) and `npm rebuild` to rebuild the native addons against the active Node ABI, per this task's own environment-quirk note.
- **Files modified:** `package.json` (gained an `allowScripts` block recording the three approvals — no dependency versions changed)
- **Verification:** `npm run typecheck`, `npm run lint`, and `npm run test` all pass afterward.
- **Committed in:** `0d9ca5b` (bundled into the Task 1 commit as environment setup, not application logic)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking/environment)
**Impact on plan:** Both were necessary for correctness (the otplib fix) or for tests to run at all (the environment setup) in a worktree with no prior `node_modules`. No scope creep — no code was added beyond what Task 1-3's action text specifies.

## Issues Encountered

None beyond the deviation above. Assertion 5 (byte-identical failure responses) held on content — all three 2FA-path failure bodies and the independently-created single-factor vault's wrong-password body compared `toEqual` each other, both status code and body. No explicit timing assertion was added; per the plan's own guidance, response-timing hardening is out of scope for this plan (the Argon2id derivation already dominates response time by design), so this was not separately measured.

## User Setup Required

None - no external service configuration required. `otplib` and `qrcode` were already present in `server/package.json` before this plan (added in the phase's dependency setup); no new packages were introduced.

## Next Phase Readiness

- Phase 1 is now complete end to end: SEC-01 through SEC-05 all have automated proof across Plans 01-01 through 01-04, and `npm run test` passes (45/45) with no regressions.
- One deferred human-check item carries into end-of-phase verification (per `human_verify_mode: end-of-phase`): running `npm run dev` with a real authenticator app to visually confirm the QR-scan flow, the exact-ten-backup-codes display with mandatory acknowledgement, the single-step unlock form showing both fields together, and the disable-requires-password flow. No low-backup-codes warning was requested since this interactive check has not yet run — flagged as a deliberate omission in this plan's `<flagged_assumptions>`, not an oversight, and open for a future phase if the human check surfaces a need for one.
- No blockers for Phase 2.

---
*Phase: 01-secure-vault-setup-unlock*
*Completed: 2026-08-18*

## Self-Check: PASSED

All 12 files listed under "Files Created/Modified" (plus this SUMMARY) confirmed present on disk. All three task commits (`0d9ca5b`, `1c48ff8`, `c8bc77b`) confirmed present in `git log`.
