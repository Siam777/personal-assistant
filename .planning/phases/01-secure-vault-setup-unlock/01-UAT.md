---
status: diagnosed
phase: 01-secure-vault-setup-unlock
source: [01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md, 01-04-SUMMARY.md]
started: 2026-08-18T15:51:06Z
updated: 2026-08-19T00:32:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server/service, clear `.vault/` and any temp state, run `npm run dev` from a clean start, and confirm the server boots without errors and `GET /api/vault/status` (via the Vite proxy at http://127.0.0.1:5173) returns live JSON.
result: pass
reported: "showing forbidden when I am trying to create vault"
severity: major
root_cause: "requireSameOriginForMutations (WR-04 code-review fix) allow-listed only http://127.0.0.1:5173 as ALLOWED_ORIGIN. User opened http://localhost:5173, so the browser sent Origin: http://localhost:5173, which failed the exact-match check and was rejected 403. Never caught by automated tests because they asserted against config.ALLOWED_ORIGIN itself, never a real second browser origin."
resolution: "Fixed same-session: config.ALLOWED_ORIGIN -> ALLOWED_ORIGINS (Set of both http://127.0.0.1:5173 and http://localhost:5173); middleware checks Set membership. Added regression test (app.test.ts it.each over both origins). 54/54 server tests passing, typecheck/lint clean. Commit d8da112."
fixed_at: 2026-08-18T22:33:00Z
verified_fix: true

### 2. npm install / dependency install (D1, 01-01)
expected: npm install completes clean with no EBADENGINE error and no fallback to source compilation for argon2/better-sqlite3-multiple-ciphers.
result: pass
source: automated
coverage_id: D1

### 3. Typecheck and lint clean (D2, 01-01)
expected: npm run typecheck and npm run lint exit 0 for both workspaces.
result: pass
source: automated
coverage_id: D2

### 4. Server test suite passes (D3, 01-01)
expected: npm run test:server passes (deps.test.ts, app.test.ts, log.test.ts) and npm run test (server+client) exits 0.
result: pass
source: automated
coverage_id: D3

### 5. Loopback-only binding (D4, 01-01)
expected: The API structurally cannot bind to a non-loopback host, and is unreachable from the LAN IP when running.
result: pass
source: automated
coverage_id: D4

### 6. KDF benchmark in range (D5, 01-01)
expected: npm run bench:kdf prints a median duration inside the 300-2000 ms window.
result: pass
source: automated
coverage_id: D5

### 7. Vault creation writes real files (D1, 01-02)
expected: A first-run user can submit a master password in the browser and the app creates a vault: vault.meta.json and vault.db both exist on disk afterwards.
result: pass
source: automated
coverage_id: D1

### 8. No-recovery acknowledgement required (D2, 01-02)
expected: Vault creation is refused unless the user has explicitly acknowledged there is no password recovery.
result: pass
source: automated
coverage_id: D2

### 9. Weak/empty password refused (D3, 01-02)
expected: Vault creation is refused for empty/whitespace-only/weak passwords, no file created.
result: pass
source: automated
coverage_id: D3

### 10. vault.db is real ciphertext (D4, 01-02)
expected: vault.db cannot be opened and read as SQLite without the derived Vault Key.
result: pass
source: automated
coverage_id: D4

### 11. No plaintext secrets in sidecar (D5, 01-02)
expected: vault.meta.json contains no plaintext master password, derived key, or secret — only ciphertext/IVs/tags/salt/non-secret KDF params.
result: pass
source: automated
coverage_id: D5

### 12. Encrypted DB round-trips (D6, 01-02)
expected: A row written to schema_version at creation is read back through the same keyed Kysely connection, proving the encrypted DB round-trips.
result: pass
source: automated
coverage_id: D6

### 13. Vault Key never leaves the process (D7, 01-02)
expected: After creation the app reports initialized+unlocked, and the Vault Key exists only as a Buffer in the Node process — never in a response body, file, or browser storage.
result: pass
source: automated
coverage_id: D7

### 14. Re-init on existing vault refused (D8, 01-02)
expected: A second vault-creation attempt against an existing vault is refused without touching the existing files.
result: pass
source: automated
coverage_id: D8

### 15. Correct-password unlock after lock (D1, 01-03)
expected: A returning user unlocks the vault with the correct master password after it was previously locked.
result: pass
source: automated
coverage_id: D1

### 16. Wrong password rejected, retry succeeds (D2, 01-03)
expected: A wrong master password is rejected, the vault stays locked, and a subsequent correct attempt still succeeds.
result: pass
source: automated
coverage_id: D2

### 17. Byte-identical failure response (D3, 01-03)
expected: A wrong password and a corrupted wrappedVaultKey ciphertext produce a byte-identical response — no response field, status code, or body distinguishes the failure cause.
result: pass
source: automated
coverage_id: D3

### 18. No-vault 409 + rate-limited unlock (D4, 01-03)
expected: Unlocking against a directory with no vault returns 409, and repeated failed unlock attempts are throttled with a response matching the generic failure body.
result: pass
source: automated
coverage_id: D4

### 19. Real 5-minute auto-lock (D5, 01-03)
expected: The vault locks itself five minutes after the last genuine user action: the key buffer is zeroed, the database handle is closed, the timer is cleared, and a direct HTTP request to a guarded route is refused afterward.
result: pass
source: automated
coverage_id: D5

### 20. Status polling never re-arms idle timer (D6, 01-03)
expected: A genuine authenticated request re-arms the idle timer; GET /api/vault/status polling does NOT re-arm it, and the vault still locks at the original five-minute mark despite repeated polling.
result: pass
source: automated
coverage_id: D6

### 21. Manual lock is idempotent (D7, 01-03)
expected: POST /api/vault/lock locks immediately and is safe to call repeatedly, including while already locked; unlocking again after an automatic lock succeeds.
result: pass
source: automated
coverage_id: D7

### 22. Test-only session accessor is inert in prod (D8, 01-03)
expected: The test-only session observability accessor never exposes key bytes and is inert outside the Vitest environment.
result: pass
source: automated
coverage_id: D8

### 23. Enrollment not committed until confirmed (D2, 01-04)
expected: Enrollment is not committed until the user proves they can generate a valid code — a scanned-but-unconfirmed secret is never persisted.
result: pass
source: automated
coverage_id: D2

### 24. Both factors required together (D4, 01-04)
expected: Once 2FA is enabled, unlocking requires both the correct master password and a valid TOTP code submitted together in one request.
result: pass
source: automated
coverage_id: D4

### 25. TOTP code alone never unlocks (D5, 01-04)
expected: A valid TOTP code alone never unlocks the vault, and enabling 2FA introduces no unlock path that skips master-password verification.
result: pass
source: automated
coverage_id: D5

### 26. Backup code single-use (D6, 01-04)
expected: An unused backup code unlocks the vault once and is consumed; the same code fails on a second use.
result: pass
source: automated
coverage_id: D6

### 27. 2FA failures byte-identical (D7, 01-04)
expected: Every 2FA-related unlock failure returns the same generic response as a wrong master password, so no response reveals which factor failed.
result: pass
source: automated
coverage_id: D7

### 28. TOTP secret encrypted at rest (D8, 01-04)
expected: The TOTP secret is stored encrypted with the Vault Key at the same standard as vault secrets — it never appears in plaintext in vault.meta.json.
result: pass
source: automated
coverage_id: D8

### 29. Backup codes stored as digests only (D9, 01-04)
expected: Backup codes are stored only as SHA-256 digests; the plaintext codes exist only in the single enrollment response.
result: pass
source: automated
coverage_id: D9

### 30. Disable/regenerate requires re-auth (D10, 01-04)
expected: Disabling 2FA or regenerating backup codes requires re-entering the master password even though the vault is already unlocked.
result: pass
source: automated
coverage_id: D10

### 31. npm run dev Ctrl-C shutdown (D6, 01-01)
expected: Running `npm run dev` from an actual interactive terminal and pressing Ctrl-C once cleanly stops all three child processes (tsc, node --watch, vite) with no orphaned process left behind.
result: issue
reported: "Pressed Ctrl-C in PowerShell; a 'Terminate batch job (Y/N)?' prompt appeared and the 'y' keystroke was not consumed by it (PowerShell then tried to run 'y' as a command and errored: 'y is not recognized'). After that, Get-Process showed two node.exe processes (PIDs 5280, 36264) still running with no path/cmdline detail to confirm which script they belonged to."
severity: major
platform_note: "Windows PowerShell — 'Terminate batch job (Y/N)?' is the classic Windows console signal-relay prompt for a process tree spawned through a shell (concurrently/npm-run-all style). This is a known Windows-only failure mode where Ctrl-C does not propagate to the full child process tree unless the dev script explicitly handles it (e.g. tree-kill, detached process groups, or a signal-relay library)."

### 32. No-recovery warning + browser storage (D9, 01-02)
expected: The no-recovery warning renders as an unmissable blocking panel with no way past it other than ticking the checkbox; the submit button stays disabled until both passwords match at sufficient strength and the box is ticked; a weak password shows readable feedback; the browser offers no "save password" prompt; and DevTools Application tab shows Local Storage and Session Storage staying empty for the origin throughout.
result: pass

### 33. Password never touches storage across unlock/lock (D9, 01-03)
expected: Reload the page with an existing vault and confirm the unlock screen appears; submit a wrong password and confirm only the generic message renders (no hint); submit the correct password and confirm the unlocked panel appears; close and reopen the tab and confirm the unlock screen reappears. Throughout, DevTools Local/Session Storage stays empty and the browser never offers to save the password. (If convenient, also observe a real 5-minute idle wait and confirm the UI transitions to LockedNotice on its own.)
result: pass

### 34. Real TOTP enrollment with an authenticator app (D1, 01-04)
expected: With the vault unlocked, enable 2FA from settings, scan the QR code with a real authenticator app (Google Authenticator/Authy), and confirm enrollment by entering a live code the app generates.
result: pass

### 35. Backup codes shown once, no way back (D3, 01-04)
expected: Enrollment shows exactly ten single-use backup codes with a mandatory save acknowledgement, and there is no way to retrieve them again afterward. Then lock the vault and confirm the unlock screen shows both password and code fields together from the start (never revealed only after the password is accepted), that password-only or code-only fails, both together succeeds, and a backup code works once then fails on reuse.
result: pass
note: "User confirmed but flagged limited time to check every sub-case exhaustively (10-code count, reuse-fails-on-second-use, etc.) — recorded as pass per explicit user confirmation, not re-litigated."

## Summary

total: 35
passed: 34
issues: 1
resolved_issues: 1
pending: 0
skipped: 0

## Gaps

- gap_id: G-01-31
  truth: "npm run dev Ctrl-C once cleanly stops all three child processes (tsc, node --watch, vite) with no orphaned process left behind"
  status: failed
  reason: "User reported: 'Terminate batch job (Y/N)?' prompt appeared on Ctrl-C, the y keystroke was not consumed by it, and two node.exe processes (PIDs 5280, 36264) remained running afterward per Get-Process"
  severity: major
  test: 31
  root_cause: "Two compounding Windows console-group Ctrl-C causes. (1) Windows delivers CTRL_C_EVENT as a broadcast to every process attached to the same console simultaneously (Node docs: without CREATE_NEW_PROCESS_GROUP, Ctrl+C reaches 'all processes in the current console group ... parents that may not gracefully handle the interrupt'). `npm run dev` puts npm.cmd (a batch file) as the literal top-level console-attached process, outside dev.mjs's SIGINT handler and taskkill mitigation entirely -- that outer cmd.exe layer is what shows 'Terminate batch job (Y/N)?'. (2) Even within dev.mjs's own subtree, killTree()'s taskkill calls are unawaited fire-and-forget spawns racing the ancestor cmd.exe teardown, and `node --watch server/dist/src/app.js` spawns its own untracked grandchild node.exe (confirmed via nodejs/node#59380) that dev.mjs never records in children[], explaining surviving node.exe PIDs."
  artifacts:
    - path: "scripts/dev.mjs"
      issue: "Children (including the non-shell `node --watch` spec) are spawned without detached/CREATE_NEW_PROCESS_GROUP, leaving them in the same console group as the outer npm.cmd/PowerShell; killTree()'s taskkill spawns are fire-and-forget, not awaited before considering shutdown complete."
    - path: "package.json"
      issue: "\"dev\": \"node scripts/dev.mjs\" invoked via `npm run dev` puts npm.cmd (a batch file) as the literal top-level console-attached process -- a layer dev.mjs cannot reach or coordinate with."
  missing:
    - "Spawn dev.mjs's three children (and the initial spawnSync build) in a new process group on Windows so they don't receive the raw console Ctrl-C broadcast directly, and await taskkill's exit before considering shutdown complete."
    - "Avoid the npm.cmd batch-file hop for tsc/vite children where possible (invoke their .js entrypoints via node directly) to eliminate nested cmd.exe 'Terminate batch job' interception points inside dev.mjs's own subtree."
    - "Document/consider `node scripts/dev.mjs` as the recommended direct invocation instead of `npm run dev`, since the outer npm.cmd layer is outside the script's control entirely."
  debug_session: ".planning/debug/npm-dev-ctrlc-orphan-processes.md"

- gap_id: G-01-1
  truth: "Kill any running server/service, clear ephemeral state, start from scratch, server boots without errors, primary query returns live data"
  status: resolved
  reason: "User reported: showing forbidden when I am trying to create vault"
  severity: major
  test: 1
  root_cause: "requireSameOriginForMutations allow-listed only http://127.0.0.1:5173; a browser opened against http://localhost:5173 (same loopback address, different origin string) was falsely rejected 403"
  resolved_by: "commit d8da112 (ALLOWED_ORIGIN -> ALLOWED_ORIGINS Set, both loopback forms)"
  resolved_at: 2026-08-18
