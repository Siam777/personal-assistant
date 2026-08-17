# Pitfalls Research

**Domain:** Personal credential/secrets vault (web app, local-only, master-password + optional TOTP 2FA) + image-to-text OCR tool (upload/drag + live camera)
**Researched:** 2026-08-18
**Confidence:** MEDIUM (cross-referenced OWASP, MDN, Tauri official docs, Bitwarden docs, and GitHub issue trackers; no single primary spec covers a "solo dev builds their own vault" scenario end-to-end, so synthesis is our own)

## Critical Pitfalls

### Pitfall 1: Rolling your own crypto primitives (custom cipher/KDF/random)

**What goes wrong:**
A solo developer builds a bespoke encryption scheme — a hand-rolled cipher, a weak/fast key derivation function (plain SHA-256 hashing of the password, or a low iteration-count PBKDF2), or a non-cryptographic random source for IVs/salts. The vault "works" in demos (encrypts and decrypts correctly for well-behaved input) but is trivially breakable by an attacker who obtains the encrypted database.

**Why it happens:**
Crypto code is easy to write and looks correct once round-tripping succeeds. Developers underestimate how much scrutiny standard algorithms have received and overestimate their own implementation's soundness. "Industry grade" gets equated with "I wrote encryption code" rather than "I used proven building blocks correctly."

**How to avoid:**
- Use only the platform's audited primitives: Web Crypto API (`crypto.subtle`) for AES-256-GCM, or Node's `crypto` module server-side — never a custom cipher.
- Use Argon2id for master-password key derivation (OWASP 2024+ recommendation: minimum memory=19MiB, iterations=2, parallelism=1 — go higher since this is a single-user local app with no server-side cost constraint). PBKDF2-SHA256 with a high iteration count (600k+) is an acceptable fallback if Argon2id isn't available in the chosen runtime.
- Never invent a key schedule, padding scheme, or "obfuscation" layer on top of AES-GCM — GCM's authentication tag already provides integrity.
- Use `crypto.getRandomValues()` / Node `crypto.randomBytes()` for all salts, IVs, and keys — never `Math.random()`.

**Warning signs:**
- Any function named `encrypt`/`decrypt` that doesn't call into `crypto.subtle` or a well-known library.
- A KDF that runs in under ~50ms (too fast = too weak against offline brute force).
- IV/salt generated from `Math.random()`, `Date.now()`, or any non-CSPRNG source.
- No published/reasoned choice of algorithm — "I encrypt it" with no named primitive.

**Phase to address:**
Foundational vault/crypto phase (before any secret is ever persisted). This is the single highest-leverage phase to get right — everything else builds on it.

---

### Pitfall 2: Storing the derived encryption key (or master password) in a place JavaScript-readable code can leak via XSS

**What goes wrong:**
The unlocked vault key or plaintext master password sits in `localStorage`, `sessionStorage`, a global variable, or Redux/state-management store for the session's duration. A single XSS vulnerability (a dependency, a rendering bug, an unsanitized note field) lets an attacker's injected script read the key and exfiltrate every decrypted secret.

**Why it happens:**
It's the path of least resistance — persisting the key makes "stay unlocked across reloads" trivial to implement, and storage APIs are simple to reach for. Developers conflate "convenient" with "safe enough for a personal tool."

**How to avoid:**
- Treat any XSS as full vault compromise — so the primary defense is preventing XSS in the first place: strict Content-Security-Policy (no `unsafe-inline`, no `eval`), output-encode all rendered user content (especially secure notes and OCR'd text, which are literally designed to hold arbitrary/attacker-influenced text), avoid `dangerouslySetInnerHTML`/`innerHTML` entirely for vault data.
- Never persist the derived key or raw master password in `localStorage`/`sessionStorage`. Keep it in memory only (a module-scoped variable or non-extractable `CryptoKey`), for the shortest practical lifetime.
- Prefer non-extractable `CryptoKey` objects (`extractable: false` in `crypto.subtle.importKey`/`deriveKey`) so even a memory-read primitive can't pull the raw key material out via JS.
- Re-derive the key from the master password on each unlock rather than caching a derived key to disk/storage at all.

**Warning signs:**
- `localStorage.setItem` or `sessionStorage.setItem` anywhere near key material, decrypted secrets, or the master password.
- CSP header missing or set to `unsafe-inline`/`unsafe-eval`.
- Any third-party npm dependency rendering user-controlled text without sanitization (charting libs, markdown renderers, rich text editors).

**Phase to address:**
Foundational vault/crypto phase for key-handling; a dedicated hardening pass (or explicit acceptance criteria baked into every phase that renders vault data) for CSP/XSS prevention, since XSS surface grows with every new UI feature (folders, tags, notes, OCR preview).

---

### Pitfall 3: Weak or absent lock/session model — "locked" UI that doesn't actually destroy the key

**What goes wrong:**
The app implements an idle-timeout that hides the vault UI and shows a "re-enter master password" screen, but the derived encryption key is still sitting in memory. Anyone with memory-inspection access (malware, a second local process, a forgotten unlocked browser tab) can still recover secrets even though the UI looks "locked."

**Why it happens:**
"Lock" is implemented as a UI/routing concern (show the unlock screen) rather than a cryptographic one (destroy the key material). It's an easy oversight because the UI *looks* correct in manual testing.

**How to avoid:**
- Define "lock" as: zero out and drop all references to the derived key and any decrypted secrets in memory, not just navigate to a lock screen. Unlocking re-derives the key from the master password (and TOTP if enabled).
- Set an explicit idle timeout tuned to the sensitivity of the data — 2–5 minutes is appropriate for a credential vault (align with NIST/CIS guidance for high-value applications), not the 15–30 minute range appropriate for low-risk apps.
- Also lock on: tab/window close, browser going to background for an extended period (visibility API), and explicit user action.
- Distinguish "lock" (destroy in-memory key, require master password again) from "logout" (also clear any session/audit context) — but for this domain, treat them the same: never leave the key resident after inactivity.

**Warning signs:**
- Idle timeout only changes a boolean `isLocked` flag or route, with no code path that clears key variables.
- No idle-timeout feature at all in the MVP.
- Timeout default is minutes-to-hours rather than single-digit minutes.

**Phase to address:**
Vault unlock/session phase, right after core encryption is built. Should have explicit UAT: "after lock, can decrypted data still be retrieved without re-entering the master password?"

---

### Pitfall 4: Clipboard leakage — copied secrets persist in OS clipboard history/sync beyond the app's control

**What goes wrong:**
User copies a password or API key to the clipboard. It then lingers in OS-level clipboard history (Windows Win+V, Android/Samsung clipboard managers), gets picked up by cloud clipboard sync, or is readable by the next foregrounded app — all in plaintext, all outside the vault's control.

**Why it happens:**
"Copy to clipboard" feels like a solved, trivial browser API call (`navigator.clipboard.writeText`), so the leakage risk downstream of that call is easy to overlook — it's an OS/platform behavior, not something the web app directly causes.

**How to avoid:**
- Auto-clear the clipboard a short time after copy (e.g., 10–20 seconds) by writing an empty string back, matching the pattern used by Bitwarden and similar tools — but only clear it if the clipboard still contains what you put there (avoid clobbering something the user copied from elsewhere in the meantime).
- Warn users in the UI that OS clipboard history/sync (Windows Clipboard History, cloud clipboard sync, Android clipboard) can retain what they copy, and that they should disable those features for maximum safety, or use the auto-clear.
- Consider this a defense-in-depth gap, not something the web app can fully close — OS-level history is outside its reach; be explicit about this limitation in the UI/docs rather than implying false safety.

**Warning signs:**
- "Copy" button implemented with no auto-clear logic at all.
- No user-facing messaging about clipboard risk near the copy action.

**Phase to address:**
Vault entry detail/view phase (wherever "copy secret" is implemented) — small feature, but easy to skip if not explicitly planned. Also relevant to the OCR "copy extracted text" action, though OCR output is typically non-secret so lower priority there.

---

### Pitfall 5: Local server/API exposed beyond localhost, or an unnecessarily broad localhost surface

**What goes wrong:**
If the app runs a local backend (Node server, or later a Tauri app with a localhost plugin) to serve the frontend or handle vault operations, it accidentally binds to `0.0.0.0` instead of `127.0.0.1`, exposing the vault's API to the local network. Or, even when loopback-only, an overly permissive local API surface becomes reachable by other processes/malware on the same machine.

**Why it happens:**
Default framework configs (dev servers especially) often bind to all interfaces for convenience during development, and that default silently ships if nobody audits the binding before packaging or "informal" local deployment. Tauri's own docs explicitly warn against using its localhost plugin/server pattern for exactly this reason.

**How to avoid:**
- Bind any local server strictly to `127.0.0.1` (never `0.0.0.0`), verified explicitly in server startup code and covered by a config test.
- For the desktop-packaging path (Tauri), prefer Tauri's custom-protocol/isolation pattern over its localhost plugin, per Tauri's own security guidance.
- Minimize the API surface shipped: only expose the specific vault operations needed, not a generic file-system or shell-command bridge; use Tauri's capability/permission allowlist to exclude unused APIs from the shipped binary entirely once desktop packaging happens.
- If the "backend" is really just local storage access (e.g., IndexedDB, SQLite via a local file), prefer no network server at all for v1 — this removes the entire class of pitfall.

**Warning signs:**
- Dev server or local API bound to `0.0.0.0` or `localhost` without explicit interface restriction in code (not just in a `.env` that could be misconfigured).
- Any endpoint reachable without the app's own auth/unlock state check.
- Desktop packaging phase introduces a localhost HTTP server "for convenience" without revisiting this decision.

**Phase to address:**
Architecture/storage-layer phase (decide local storage approach — ideally no network server for v1) and revisited explicitly in the desktop-packaging phase when Tauri/Electron is introduced.

---

### Pitfall 6: Plaintext backup/export files left on disk

**What goes wrong:**
Export-to-CSV (or unencrypted JSON) is implemented for portability/backup, and the resulting plaintext file lingers in Downloads, cloud-sync folders, search indexes, or old backups — becoming a single file that contains every secret the vault holds, unprotected, potentially more damaging than a device theft.

**Why it happens:**
Export is often treated as a "nice to have" utility feature bolted on without the same security scrutiny as the core vault, and CSV is the easy universal format. The risk lives entirely in what happens to the file *after* export, which is outside the app's direct control once written to disk.

**How to avoid:**
- If backup/export is included in v1 scope, default to an encrypted export format (the exported blob re-encrypted with the master password or a separate export passphrase) rather than plaintext CSV/JSON.
- If a plaintext export option is offered at all (e.g., for interoperability with another tool), gate it behind an explicit warning dialog explaining the risk, and where feasible, prompt/remind the user to delete the file after use.
- Never write temp/intermediate plaintext export files to disk as part of generating the final encrypted export — build the plaintext in memory only.

**Warning signs:**
- Export feature writes a `.csv` file with no encryption step and no warning.
- No mention of backup/export security in the phase acceptance criteria at all — meaning it could get added late as an afterthought.

**Phase to address:**
Not in v1 scope per PROJECT.md (backup/export isn't an explicit v1 requirement) — flag as a pitfall to watch for if/when export is added in a future milestone, and make sure it doesn't get silently smuggled into a "quick CSV export" ticket without this review.

---

### Pitfall 7: Sensitive data rendered/logged where it shouldn't be (server logs, error messages, browser devtools, audit log itself)

**What goes wrong:**
Decrypted secret values end up in application logs, error/exception messages (e.g., a stack trace that includes a form field value), browser console output during debugging, or — ironically — the audit log itself (which should record *that* a secret was accessed, never *what* the secret's value was).

**Why it happens:**
Generic error handling and logging code paths don't distinguish "this variable might contain a secret" from any other variable; debug `console.log` statements added during development don't get removed; the audit log feature gets built by the same code path that has access to the decrypted value, and it's easy to accidentally include it "for debugging."

**How to avoid:**
- Design the audit log schema up front to record only metadata: entry ID, entry type/name, timestamp, action (viewed/copied/edited) — never the secret value itself, never even in a debug-only field.
- Strip/redact potentially sensitive fields in any global error handler or logging middleware before logs are written.
- Lint/review rule: no `console.log` of vault entry objects or decrypted values; prefer a debug flag that's off by default and never enabled in the packaged/shipped build.
- Test with actual audit log entries created during manual QA to visually confirm no plaintext leaks through.

**Warning signs:**
- Audit log table/schema includes a `value` or `secret` column.
- Any `console.log`/`console.error` call whose argument is a full vault-entry object rather than an ID.
- Error boundary or global exception handler that serializes the full request/state object.

**Phase to address:**
Audit log implementation phase, plus a cross-cutting review at the end of the vault-core phase before it's considered "done."

---

### Pitfall 8: OCR/camera feature treated as "just a UI feature," ignoring memory and privacy pitfalls

**What goes wrong:**
Two related failure modes: (1) large or high-resolution images (especially from a live camera capture, which can be several MB / high-res) fed directly into the OCR engine without downscaling cause runaway memory growth — Tesseract.js's WebAssembly heap grows to accommodate a large image and never shrinks back, so a single oversized photo permanently bloats memory for the life of that worker (documented, RAM usage reported in the 10GB+ range in extreme cases); (2) camera access is requested without a clear justification, streams aren't stopped after use, and the always-on camera indicator/permission stays active longer than needed, undermining user trust in what's supposed to be a personal-privacy-respecting tool.

**Why it happens:**
Developers wire up `getUserMedia()` and pass the raw captured frame straight into the OCR call because it "just works" in testing with a webcam at a modest resolution; the memory-growth problem only shows up with larger images typical of a real phone camera or a large uploaded photo, which may not appear during early development.

**How to avoid:**
- Downscale/resize any image (uploaded or captured) client-side before passing it to OCR — roughly 1200px on the long edge preserves text legibility while cutting memory usage significantly (~56% less than a 4K image) versus feeding the full-resolution image in.
- Use a bounded Tesseract.js worker pool via a scheduler (a fixed small pool, e.g. 2–4 workers) rather than spawning a new worker per OCR request; terminate/recycle workers rather than assuming memory will shrink back down on its own (it won't).
- Explicitly call `.stop()` on every `MediaStreamTrack` when the camera view is closed or a capture is taken, so the OS in-use indicator turns off promptly and the resource is released.
- Show the "why we need camera access" explanation before triggering the permission prompt (not required by spec, but meaningfully improves trust and reduces user "deny by reflex" behavior).
- Set accuracy expectations correctly in the UX: Tesseract lags well behind cloud OCR engines (Google Vision, PaddleOCR) especially on angled/noisy real-world photos from a live camera vs. clean uploaded screenshots — the Lens-style "preview before use" step (already in scope) is the right mitigation, but the UI should make it easy to retry/re-crop rather than presenting OCR output as ground truth.
- `getUserMedia()` requires a secure context (HTTPS, or `localhost` in dev) — verify this doesn't silently break camera capture when testing across different local dev URLs.

**Warning signs:**
- OCR call takes the raw `File`/`Blob` or raw canvas frame with no resize step in between.
- No visible/enforced max-workers limit around Tesseract.js usage.
- Browser tab memory climbs and never comes back down after processing a large image, even after the result is displayed.
- Camera stream still shows as "active" (mic/camera indicator lit) after the user navigates away from the capture view.

**Phase to address:**
OCR/camera capture phase. Downscaling and worker-pool bounding should be part of the initial implementation, not a later optimization pass, since the failure mode (unbounded memory growth) is a correctness issue for a client-side/local-first tool, not just a performance nicety.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Skipping idle-timeout/auto-lock in early builds | Faster iteration, no re-login friction during dev | Vault stays "unlocked" indefinitely in practice; easy to ship without it | Only during local dev before first real secret is stored; must land before any milestone considered "done" |
| Using a fixed/low iteration count for the KDF "to make dev faster" | Snappier unlock while testing | If the low-cost setting ships to production, brute-force resistance collapses | Never in a shipped build; fine as a dev-only env override, never the default |
| Storing decrypted vault state in a global/module variable without explicit lifecycle management | Simple to wire up UI reactivity | No clear "this is when the key must be destroyed" contract, making the lock feature (Pitfall 3) easy to half-implement | Acceptable short-term if the destroy-on-lock path is planned and tracked, not silently deferred |
| Feeding OCR the full-resolution image without downscaling | One less processing step, "it works" on small test images | Memory blow-up and slow recognition on real camera photos (Pitfall 8) | Never — downscaling is cheap to add and the failure mode is severe |
| Plaintext CSV export as a quick "backup" utility | Fast to build, easy to test | Creates a standing plaintext liability on disk (Pitfall 6) | Only if explicitly out of v1 scope (as it currently is) — do not add casually later |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|-----------------|-------------------|
| Web Crypto API (`crypto.subtle`) | Reusing an IV across multiple encryptions with the same key, or generating IVs with a non-CSPRNG source | Generate a fresh 12-byte IV via `crypto.getRandomValues()` for every single encryption operation |
| TOTP (2FA) library | Storing the TOTP secret unencrypted alongside the vault, or not requiring the master password to view/reset it | Encrypt the TOTP secret with the same vault encryption; require full re-authentication to view or disable 2FA |
| Tesseract.js | Spawning a new worker per OCR call, or feeding it raw large images | Use a scheduler with a small fixed worker pool; downscale images before passing them in |
| `getUserMedia()` (camera) | Never calling `track.stop()`, leaving the camera indicator on | Explicitly stop every track when the capture view unmounts or after a shot is taken |
| Tauri (future desktop packaging) | Reaching for the localhost plugin/server for convenience | Use Tauri's custom-protocol/isolation pattern; scope the capability/permission allowlist tightly |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Unbounded Tesseract.js workers/memory | Browser tab RAM climbs continuously across OCR uses and never drops | Bounded worker pool + image downscaling before OCR | First large (multi-MP) camera photo or a handful of back-to-back OCR calls |
| Client-side re-encryption of the entire vault on every single field edit | Save/edit actions feel sluggish as entry count grows | Encrypt/decrypt at the individual-entry granularity, not the whole vault blob, once entry count is non-trivial (dozens+) | Noticeable once the vault holds on the order of 100+ entries, if the whole-vault-blob approach was chosen for simplicity early on |
| Full-text search implemented by decrypting every entry on every keystroke | Search feels laggy as entries grow | Decrypt once per unlock session into an in-memory searchable index (not persisted), re-index on unlock | Scales acceptably for a single-user local vault (hundreds of entries) but the always-decrypt-on-keystroke version degrades first |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Deriving the encryption key directly from the master password with no per-vault salt | Two vaults with the same master password produce the same key; precomputation/rainbow-table-style attacks become feasible if the encrypted DB leaks | Generate a unique random salt per vault at creation, store it alongside (not instead of) the encrypted data, and use it in every KDF call |
| No distinction between "wrong master password" and "corrupted vault" errors that reveals structural info | Verbose error messages can help an attacker fingerprint internals | Use AES-GCM's authentication tag to fail generically ("Unable to unlock") on any decryption failure, regardless of cause |
| TOTP treated as a replacement for, rather than layered on top of, the master password | If TOTP secret storage is weaker than the vault's encryption, 2FA becomes the weak link instead of a strengthening factor | 2FA must gate access to an already-independently-encrypted vault, not be the vault's only protection |
| Trusting client-side-only validation for "strong master password" | Weak master passwords undermine every other security measure, since KDF strength can't compensate for a guessable password | Enforce a minimum entropy/strength check at vault creation and warn (not just suggest) on weak choices |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Forgotten master password = permanently lost vault, with no warning at setup | User loses every stored secret with zero recourse (by design, since there's no plaintext backdoor) | Make this tradeoff explicit and unmissable at vault creation ("There is no password reset — losing this password means losing all data"), and consider an optional printable/offline recovery-key mechanism |
| Auto-lock timeout with no visible warning before it fires | User loses in-progress work (e.g., mid-edit on a note) when the vault suddenly locks | Show a countdown/warning shortly before auto-lock triggers, or preserve draft state so it's recoverable after re-unlock |
| OCR preview presented as if it were 100% accurate | User copies/pastes incorrect text (e.g., a mis-OCR'd API key) into a critical field without noticing | Make the preview clearly editable before copy, and visually flag low-confidence characters if the OCR engine exposes confidence scores |
| Copy-to-clipboard with no feedback on auto-clear | User assumes the secret stays on the clipboard indefinitely (or doesn't realize it clears and re-copies unnecessarily) | Show a brief toast/timer indicating "Copied — will clear in Ns" |

## "Looks Done But Isn't" Checklist

- [ ] **Encryption at rest:** Often "done" means fields are encrypted in the database, but backups, exports, temp files, or in-memory caches used for search/indexing are still plaintext — verify every place the data touches disk or a long-lived in-memory structure.
- [ ] **Auto-lock:** Often "done" means the UI shows a lock screen, but the derived key is never actually zeroed from memory — verify by inspecting whether decrypted data is retrievable via any code path after "lock" without re-entering the master password.
- [ ] **Audit log:** Often "done" means access events are recorded, but the log itself may contain the secret value, or may be missing coverage for less-obvious access paths (e.g., search results, autofill-style copy shortcuts) — verify every read/copy/export path writes an audit entry with metadata only.
- [ ] **OCR camera capture:** Often "done" means it works on a laptop webcam with good lighting during a demo, but breaks (memory, accuracy, permission prompts) with a real high-resolution phone camera image or in a cross-origin/iframe embedding — verify with an actual large photo and on the target real-world hardware.
- [ ] **2FA (TOTP):** Often "done" means codes generate and validate correctly, but the TOTP secret's own storage/encryption is overlooked — verify the TOTP seed is encrypted at the same standard as vault secrets, not stored as a convenience plaintext field.
- [ ] **Clipboard copy:** Often "done" means `navigator.clipboard.writeText()` succeeds, but no auto-clear or user warning about OS clipboard history exists — verify the copied value doesn't linger indefinitely and that OS-level exposure risk is communicated.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|-----------------|------------------|
| Weak/custom crypto shipped and later discovered | HIGH | Requires a full re-encryption migration: derive new keys with the correct KDF/cipher, decrypt every entry with the old (weak) scheme, re-encrypt with the corrected scheme, and force all existing "vaults" through a one-time migration on next unlock |
| Key/secret found to have been persisted in localStorage | HIGH | Treat as an assumed compromise for any user who ran the affected version: force a master-password rotation on next unlock, purge the offending storage keys, and audit git history for any accidentally committed sample data |
| Plaintext leaked into logs/audit log | MEDIUM | Purge affected log entries/audit rows, rotate any secrets that were exposed (since they must be treated as compromised), and add a regression test asserting no plaintext appears in new audit rows |
| Tesseract.js memory blow-up shipped to users | LOW | Add image downscaling and worker-pool bounding as a patch release; no data-integrity impact, purely a client-side performance fix |
| Camera stream left open after capture | LOW | Add explicit `track.stop()` calls on unmount/capture-complete; no data impact, but should be tested with the OS-level camera-in-use indicator to confirm the fix |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| Rolling your own crypto | Foundational vault/crypto phase | Code review confirms only `crypto.subtle`/Node `crypto` primitives used, named KDF (Argon2id or PBKDF2 600k+) with documented parameters, CSPRNG for all salts/IVs |
| Key/secret leakage via XSS-reachable storage | Foundational vault/crypto phase + ongoing CSP/XSS discipline across all UI-adding phases | Grep for `localStorage`/`sessionStorage` near key material; CSP header present and free of `unsafe-inline`/`unsafe-eval`; manual XSS test on any field that renders user-supplied text (notes, OCR output) |
| Weak lock/session model | Vault unlock/session phase | UAT: after triggering lock, attempt to read decrypted data via app state/devtools without re-entering master password — must fail |
| Clipboard leakage | Vault entry detail/copy-action phase | Manual test: copy a secret, wait past the auto-clear window, confirm clipboard is empty; confirm risk messaging is visible in UI |
| Exposed local server/API | Storage architecture phase; revisited at desktop-packaging phase | Confirm no network server exists for v1 (or if one does, it's bound to `127.0.0.1` only, verified by an automated startup check) |
| Plaintext backup/export leak | Out of scope for v1 — flag if added in a future milestone | If/when export ships: confirm default output is encrypted, plaintext option (if any) carries an explicit warning |
| Sensitive data in logs/audit log | Audit log phase + end-of-phase review for vault-core | Manually trigger errors and audit-log-generating actions; inspect logs/DB for any secret value, not just metadata |
| OCR/camera memory & privacy pitfalls | OCR/camera capture phase | Test with a real large (multi-MP) photo; confirm memory returns to baseline after processing; confirm camera indicator turns off after capture/navigation away |

## Sources

- [Password Storage - OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — MEDIUM confidence
- [OWASP CheatSheetSeries GitHub](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Password_Storage_Cheat_Sheet.md) — MEDIUM confidence
- [MDN: AesGcmParams](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams) — MEDIUM confidence
- [AES-256-GCM Encryption in the Browser with Web Crypto](https://miguelacm.es/en/blog/aes-256-encryption-browser) — MEDIUM confidence
- [Dangers of Storing Sensitive Data in Web Storage — Raxis](https://raxis.com/blog/dangers-of-storing-sensitive-data-in-web-storage/) — MEDIUM confidence
- [Why avoiding LocalStorage for tokens is the wrong solution — Pragmatic Web Security](https://pragmaticwebsecurity.com/articles/oauthoidc/localstorage-xss.html) — MEDIUM confidence
- [OWASP HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html) — MEDIUM confidence
- [Open Source Password Managers 2026 — Practical IT Guide](https://unlocked.everykey.com/open-source-pw-mgr-a-practical-guide-to-open-source-password-managers-for-it-teams/) — MEDIUM confidence
- [Rolling Your Own Crypto — loup-vaillant.fr](https://loup-vaillant.fr/articles/rolling-your-own-crypto) — MEDIUM confidence
- [10 Cryptography Mistakes You're Probably Making — AppSecEngineer](https://www.appsecengineer.com/blog/10-cryptography-mistakes-youre-probably-making) — MEDIUM confidence
- [Preventing secrets from leaking through Clipboard — Mozilla Security Blog](https://blog.mozilla.org/security/2021/12/15/preventing-secrets-from-leaking-through-clipboard/) — MEDIUM confidence
- [Your clipboard is only as secure as your device — Ctrl blog](https://www.ctrl.blog/entry/clipboard-security.html) — MEDIUM confidence
- [Samsung admits Galaxy devices can leak passwords through clipboard wormhole — The Register](https://www.theregister.com/2025/04/28/security_news_in_brief/?td=rt-3a) — MEDIUM confidence
- [Tauri v2 Localhost plugin docs](https://v2.tauri.app/plugin/localhost/) — MEDIUM confidence
- [Tauri v2 Application Lifecycle Threats](https://v2.tauri.app/security/lifecycle/) — MEDIUM confidence
- [Beyond Electron: Attacking Alternative Desktop Application Frameworks — Bishop Fox](https://bishopfox.com/blog/beyond-electron-attacking-alternative-desktop-application-frameworks) — MEDIUM confidence
- [Automatic Logout or Lock — Bitwarden Help](https://bitwarden.com/help/vault-timeout/) — MEDIUM confidence
- [An automatic session lock: True Timeout — Hideez](https://hideez.com/blogs/news/automatic-session-lock) — MEDIUM confidence
- [10 Mistakes When Switching Password Managers (2026) — Alphonso Labs](https://www.alphonsolabs.com/switching-password-manager-mistakes-lockouts/) — MEDIUM confidence
- [Understanding Encrypted Export — Bitwarden Community Forums](https://community.bitwarden.com/t/understanding-encrypted-export/43149) — MEDIUM confidence
- [MDN: MediaDevices.getUserMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) — MEDIUM confidence
- [MDN: Permissions-Policy camera directive](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/camera) — MEDIUM confidence
- [Large images cause excessive memory usage — tesseract.js GitHub Issue #900](https://github.com/naptha/tesseract.js/issues/900) — MEDIUM confidence
- [tesseract.js performance docs](https://github.com/naptha/tesseract.js/blob/master/docs/performance.md) — MEDIUM confidence
- [Slow recognition, randomly stops and 10gb+ RAM usage — tesseract.js GitHub Issue #446](https://github.com/naptha/tesseract.js/issues/446) — MEDIUM confidence
- [Integrating OCR in the browser with tesseract.js — Transloadit](https://transloadit.com/devtips/integrating-ocr-in-the-browser-with-tesseract-js/) — MEDIUM confidence
- [Evaluating OCR Performance for Assistive Technology (arXiv)](https://arxiv.org/pdf/2602.02223) — MEDIUM confidence

---
*Pitfalls research for: personal credential/secrets vault + image-to-text OCR tool*
*Researched: 2026-08-18*
