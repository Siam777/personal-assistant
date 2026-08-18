---
phase: 01-secure-vault-setup-unlock
reviewed: 2026-08-18T00:00:00Z
depth: standard
files_reviewed: 34
files_reviewed_list:
  - client/package.json
  - client/src/App.tsx
  - client/src/features/vault-2fa/BackupCodesPanel.tsx
  - client/src/features/vault-2fa/DisableWithReauthScreen.tsx
  - client/src/features/vault-2fa/EnrollScreen.tsx
  - client/src/features/vault-2fa/TwoFactorSettings.tsx
  - client/src/features/vault-unlock/InitScreen.tsx
  - client/src/features/vault-unlock/LockedNotice.tsx
  - client/src/features/vault-unlock/NoRecoveryWarning.tsx
  - client/src/features/vault-unlock/UnlockScreen.tsx
  - client/src/lib/api.ts
  - client/src/lib/session-signals.ts
  - client/src/main.tsx
  - client/vite.config.ts
  - eslint.config.js
  - package.json
  - package-lock.json
  - scripts/dev.mjs
  - server/package.json
  - server/scripts/bench-kdf.ts
  - server/src/app.test.ts
  - server/src/app.ts
  - server/src/config.ts
  - server/src/deps.test.ts
  - server/src/log.test.ts
  - server/src/log.ts
  - server/src/middleware/errorHandler.ts
  - server/src/middleware/rateLimit.ts
  - server/src/middleware/requireUnlocked.ts
  - server/src/middleware/validate.ts
  - server/src/modules/auth/autolock.test.ts
  - server/src/modules/auth/crypto.test.ts
  - server/src/modules/auth/crypto.ts
  - server/src/modules/auth/routes.ts
  - server/src/modules/auth/session.ts
  - server/src/modules/auth/totp.test.ts
  - server/src/modules/auth/totp.ts
  - server/src/modules/auth/two-factor-unlock.test.ts
  - server/src/modules/auth/unlock.test.ts
  - server/src/modules/auth/vault-init.test.ts
  - server/src/modules/auth/vaultMeta.ts
  - server/src/modules/db/connection.ts
  - server/src/modules/db/schema.ts
  - server/src/types.ts
  - server/tsconfig.json
findings:
  critical: 1
  warning: 7
  info: 1
  total: 9
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-08-18
**Depth:** standard
**Files Reviewed:** 34 (list above includes lockfiles/config counted for scope but not individually findable)
**Status:** issues_found

## Summary

Reviewed the merged output of all four Phase 1 plans (scaffold, vault creation, unlock/auto-lock, TOTP 2FA). The core cryptographic primitives are sound: Argon2id raw-mode key derivation, fresh-IV AES-256-GCM envelope wrapping, atomic sidecar writes, constant-time backup-code comparison, and a single generic `vaultAuthError()` collapsing every unlock-path failure into a byte-identical response are all implemented correctly and are backed by real end-to-end tests that exercise the actual crypto (not mocks). The idle-timer auto-lock genuinely zeroes key material and closes the DB handle, verified over real HTTP round trips.

That said, several real defects surfaced on close reading:

- A concrete authentication/authorization gap: `POST /api/vault/2fa/confirm` has no rate limiting, unlike `POST /api/vault/unlock`, turning a 6-digit-code confirmation into a fast local brute-force target within its 5-minute pending-enrollment window — and, because first-time 2FA enrollment requires only an unlocked session (not a re-typed master password), a successful guess lets an attacker silently attach a second factor of their own choosing to a no-recovery vault.
- A genuine client-side logic bug: the "Unlock again" button on `LockedNotice` mutates a `ref` instead of state, so it does not actually cause a re-render — the screen only updates on the next unrelated poll or visibility event.
- Several defense-in-depth gaps: no CSRF/Origin check on state-changing routes (loopback binding does not stop a malicious page open in the same browser), a fragility in how KDF cost parameters are re-derived on unlock relative to what's actually persisted, an unhandled-rejection risk in `session.lock()`'s fire-and-forget `db.destroy()`, a TOCTOU/lost-update risk on the unencrypted sidecar file, and a keyword-blocklist-based log redaction scheme with a real (if currently unused) coverage gap.

None of these undermine the core "master password proven before second factor is ever checked" invariant, which is correctly enforced and tested. The findings below are things that should be fixed or at least consciously accepted before this ships.

## Critical Issues

### CR-01: `POST /api/vault/2fa/confirm` has no rate limiting — brute-forceable, and can silently attach an attacker-controlled second factor to a no-recovery vault

**File:** `server/src/modules/auth/routes.ts:345-366` (route), `server/src/modules/auth/totp.ts:110-184` (`beginEnrollment` / `confirmEnrollment`)
**Issue:** `unlockRateLimit` is deliberately mounted only on `POST /api/vault/unlock` (`server/src/middleware/rateLimit.ts:17-30`). `POST /api/vault/2fa/confirm` has no throttle of any kind. The confirmation check (`verify({ secret, token: code, epochTolerance: 30 })` in `otplib`) is a cheap, sub-millisecond operation with no Argon2id cost gating it — unlike the master-password path. A 6-digit TOTP code is a 10^6 search space, and `PENDING_ENROLLMENT_TTL_MS` gives an attacker a fixed 5-minute window (`totp.ts:39`) to brute-force it at whatever request rate the loopback socket allows (thousands/sec locally), which is more than sufficient to guess a code before the pending enrollment expires.

Critically, `POST /api/vault/2fa/enroll` requires only `requireUnlocked` — no re-submitted master password (`routes.ts:329`, explicitly documented as a deliberate "D-06 reads first-time enrollment as needing only [an unlocked session]" decision). Combined, this means: anyone who can reach the loopback API while the vault happens to be unlocked (e.g. via the CSRF gap in WR-04 below, or brief physical access) can call `/2fa/enroll` to obtain a secret, and brute-force `/2fa/confirm` against it without needing to know the master password at all. A successful guess enables 2FA under a secret the legitimate owner never scanned, and because D-05 provides no password-reset/recovery path, this can permanently lock the real owner out of their own vault.

**Fix:** Mount a rate limiter on `/2fa/confirm` (and ideally `/2fa/enroll`) with the same or a stricter policy than `unlockRateLimit`, routed through the same `vaultAuthError()` path so a rate-limited response stays indistinguishable from an "invalid code" response:
```ts
// server/src/middleware/rateLimit.ts
export const twoFactorConfirmRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(vaultAuthError()),
});

// server/src/modules/auth/routes.ts
vaultRouter.post(
  "/2fa/confirm",
  requireUnlocked,
  twoFactorConfirmRateLimit,
  validate(confirmEnrollmentBodySchema),
  ...
);
```
Separately, reconsider whether first-time enrollment should require a freshly re-submitted master password (matching the `disable`/`regenerate` re-auth requirement) rather than relying on session state alone — the current asymmetry (disable needs reauth, enable does not) is the root cause that makes the missing rate limit exploitable at all.

## Warnings

### WR-01: `LockedNotice`'s "Unlock again" button mutates a ref and never re-renders

**File:** `client/src/App.tsx:127-138`
**Issue:**
```tsx
if (wasUnlockedRef.current) {
  return (
    <main>
      <LockedNotice
        onReturnToUnlock={() => {
          wasUnlockedRef.current = false;
        }}
      />
    </main>
  );
}
```
`wasUnlockedRef` is a `useRef`, and mutating `.current` does not schedule a React re-render. Clicking "Unlock again" sets the ref to `false` but the component tree does not re-evaluate, so the UI keeps showing `LockedNotice` until something else (the 15-second status poll, or a `visibilitychange` event) happens to call `setStatus`/force a re-render. In practice the button silently does nothing for up to 15 seconds, which reads as broken to a user.
**Fix:** Use state (or force a re-render another way) instead of a plain ref for the value that gates this branch:
```tsx
const [wasUnlocked, setWasUnlocked] = useState(false);
if (status?.unlocked) setWasUnlocked(true); // still needs to run in an effect/derived form, not during render as-is — restructure with useEffect or a state updater keyed off `status`.
...
<LockedNotice onReturnToUnlock={() => setWasUnlocked(false)} />
```
(Any change that ends in a `setState` call works; the key defect is that the current fix path is ref-only.)

### WR-02: `deriveMasterKey`'s `hashLength`/`type` are always read from the live `config.KDF_PARAMS`, not from anything persisted per-vault

**File:** `server/src/modules/auth/crypto.ts:38-50`, `server/src/types.ts:18-24`
**Issue:**
```ts
export async function deriveMasterKey(
  password: string,
  salt: Buffer,
  kdfCostParams: KdfCostParams = config.KDF_PARAMS
): Promise<Buffer> {
  return argon2.hash(password, {
    type: config.KDF_PARAMS.type,
    hashLength: config.KDF_PARAMS.hashLength,
    ...kdfCostParams,
    salt,
    raw: true,
  });
}
```
`KdfCostParams` only carries `memoryCost`/`timeCost`/`parallelism` (`crypto.ts:23-27`), and `VaultMeta.kdf` only persists those three plus `saltB64` (`types.ts:18-24`) — `hashLength` is never recorded anywhere. The module's own docstring claims "a vault created under older or different calibrated parameters must still open even after `config.KDF_PARAMS` changes" (`crypto.ts:34-36`), but that is only true for `memoryCost`/`timeCost`/`parallelism`. If `config.KDF_PARAMS.hashLength` is ever changed (e.g. a future scheme bump), every existing vault's Master Key would be re-derived at the new length, `unwrapKey` would fail the auth-tag check against the old `wrappedVaultKey`, and the failure would be indistinguishable from a wrong password — silently and permanently locking out every vault created before the change, with no recovery path (D-05).
**Fix:** Persist `hashLength` (and, if `type` is ever meant to vary, `type`) in `VaultMeta.kdf` alongside the other cost parameters, and thread it through `KdfCostParams` so `deriveMasterKey` always uses the value recorded at vault-creation time rather than whatever the current build's `config.KDF_PARAMS` happens to say.

### WR-03: `session.lock()`'s fire-and-forget `db.destroy()` has no error handling, unlike every other call site

**File:** `server/src/modules/auth/session.ts:62-78`
**Issue:**
```ts
export function lock(): void {
  ...
  if (db) {
    void db.destroy();
  }
  db = null;
  ...
}
```
Every other place this codebase closes a Kysely handle wraps it in `try { await db.destroy(); } catch { ... }` (`routes.ts:166-172`, `277-286`). `lock()` is the one place that both doesn't await and doesn't catch. `lock()` fires from the idle timer (`session.ts:53`) and from `POST /lock` (routes.ts:298-301) with no external trigger to observe or retry a failure — if `destroy()` ever rejects (e.g. a mid-flight query, a locked file handle on Windows), that becomes an unhandled promise rejection, which under Node's default behavior can crash the process, taking down the entire local server (and, per D-03, defeating the very auto-lock this function implements).
**Fix:**
```ts
if (db) {
  db.destroy().catch(() => {
    // best-effort close; the vault is already considered locked either way
  });
}
```

### WR-04: No CSRF/Origin protection on state-changing routes — loopback binding alone does not stop a same-browser malicious page

**File:** `server/src/app.ts:15-25`, `server/src/modules/auth/routes.ts` (all `POST` routes)
**Issue:** The server binds to loopback only (D-02) and correctly refuses to bind elsewhere, but that only stops other *machines*. It does not stop a malicious web page the user has open in another tab of the *same browser* from reaching `http://127.0.0.1:5174/api/vault/*` directly. There is no session cookie, CSRF token, or `Origin`/`Sec-Fetch-Site` check anywhere in `app.ts`, `requireUnlocked.ts`, or `routes.ts` — "unlocked" is purely a process-global flag with no binding to the requesting origin at all. A hidden auto-submitting HTML form (or `navigator.sendBeacon`) from any other open tab can issue a "simple request" `POST` (no CORS preflight required) to, at minimum, `POST /api/vault/lock` (no body needed, always succeeds while unlocked) — forcing an unwanted re-lock — and to `POST /api/vault/2fa/enroll` (also no body required, gated only by `requireUnlocked`), creating a harmless-but-unsolicited pending TOTP secret. Combined with CR-01's missing rate limit, a same-browser malicious page is a realistic delivery vector for the enrollment-hijack scenario described there.
**Fix:** Add a lightweight Origin check to reject cross-origin state-changing requests (the Vite dev proxy makes all legitimate traffic same-origin already), e.g. a small middleware run before every mutating route that rejects unless `req.headers.origin` is absent (non-browser/CLI clients) or matches the expected dev-server origin. Alternatively/additionally, require a custom header (e.g. `X-Requested-With`) on all `/api/vault/*` POSTs — simple cross-origin form submissions cannot set custom headers, which forces a CORS preflight that will fail without an explicit `Access-Control-Allow-Origin`.

### WR-05: No rate limiting on `/2fa/disable` or `/2fa/backup-codes/regenerate` reauthentication

**File:** `server/src/modules/auth/routes.ts:378-422`, `310-323`
**Issue:** `reauthenticateWithMasterPassword` re-derives the Master Key and re-unwraps the Vault Key exactly like `/unlock` does — it is a full master-password guess-and-check oracle — but neither `/2fa/disable` nor `/2fa/backup-codes/regenerate` is behind `unlockRateLimit` or any other throttle, unlike `/unlock`. Argon2id's ~470ms cost provides some inherent throttling, but that permits roughly 120+ guesses/minute versus the ~10/minute the design deliberately imposes on `/unlock`, meaningfully weakening the throttling policy the codebase otherwise treats as important (`rateLimit.ts`'s docstring explicitly frames this as intentional design for the unlock route).
**Fix:** Apply the same (or an equivalent) rate limiter to these two routes:
```ts
vaultRouter.post("/2fa/disable", requireUnlocked, unlockRateLimit, validate(reauthBodySchema), ...);
vaultRouter.post("/2fa/backup-codes/regenerate", requireUnlocked, unlockRateLimit, validate(reauthBodySchema), ...);
```

### WR-06: TOCTOU / lost-update risk when consuming a backup code in `verifySecondFactor`

**File:** `server/src/modules/auth/totp.ts:199-254`, `server/src/modules/auth/routes.ts:225, 252-256`
**Issue:** `verifySecondFactor(code, vaultKey, meta)` is handed a `meta` object read once at the start of the `/unlock` handler (`routes.ts:225`). When a backup code matches, it writes back a full sidecar snapshot built from that same `meta` reference (`totp.ts:247-251`) rather than re-reading the sidecar immediately before the write. If another request (e.g. a concurrent backup-code regeneration or a second in-flight unlock attempt) writes `vault.meta.json` in between the initial read and this write, that update is silently lost — `writeVaultMetaAtomic` overwrites the whole file with the stale snapshot plus this one field change. Given Node's single-threaded event loop with multiple `await` points in this flow, two overlapping requests are enough to trigger it.
**Fix:** Re-read the sidecar immediately before the write inside `verifySecondFactor` (or otherwise serialize sidecar writes, e.g. via an in-process write queue/mutex), rather than trusting a `meta` snapshot captured earlier in a different function.

### WR-07: Log redaction is a manually-maintained keyword blocklist with a real coverage gap

**File:** `server/src/log.ts:15-16`, `server/src/types.ts:47-51`
**Issue:** `SECRET_KEY_PATTERN` redacts field values by matching the *key name* against a fixed word list (`password|secret|key|token|code|salt|iv|authtag|cipher(text)?`). This is a blocklist, not an allowlist, so any secret-bearing field whose name doesn't happen to match one of those words is logged in the clear if it's ever passed to `logInfo`/`logError`. Concretely, `EnrollmentStart.qrDataUrl` (`types.ts:47-51`) is a base64 PNG data URL that encodes the full `otpauth://` URI — including the TOTP secret — and its key name (`qrDataUrl`) does not match any term in the pattern, so it would not be redacted if ever logged (e.g. a future debug log of the full enrollment response). No current call site logs this object, so there is no live leak today, but the module's stated goal — making "never log the master password or derived key at any level... mechanically true rather than a convention someone has to remember" (`log.ts:1-11`) — is not actually mechanically guaranteed for anything outside the fixed word list.
**Fix:** Either broaden the pattern to include terms like `uri`, `url`, `qr`, `blob`, `data` (accepting more over-redaction), or invert the approach for known-sensitive response shapes (e.g. explicitly strip `qrDataUrl`/`secret` before ever constructing a loggable object from an enrollment result), so the guarantee doesn't depend on every future field name happening to contain a listed word.

## Info

### IN-01: `SECRET_KEY_PATTERN` uses unanchored substring matching, causing false-positive redaction

**File:** `server/src/log.ts:15-16`
**Issue:** The regex `/password|secret|key|token|code|salt|iv|authtag|cipher(text)?/i` is tested with `.test(keyName)` with no word boundaries, so short terms like `iv` and `key` match as substrings of unrelated field names — e.g. `"isActive"` contains `"tive"` → matches `iv`; `"monkey"`, `"keyboard"`, `"turkey"` all match `key`; `"barcode"`/`"unicode"` match `code`. This only causes *over*-redaction (safe direction), but it will quietly hide legitimate, non-secret diagnostic fields as the log surface grows, making `logInfo`/`logError` output less useful without anyone noticing why.
**Fix:** Use word-boundary matching, e.g. `/\b(password|secret|key|token|code|salt|iv|authtag|cipher(text)?)\b/i`, and add a regression test asserting a benign key like `isActive` is *not* redacted.

---

_Reviewed: 2026-08-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
