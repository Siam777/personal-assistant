# Phase 1: Secure Vault Setup & Unlock - Pattern Map

**Mapped:** 2026-08-18
**Files analyzed:** 17 (proposed new files)
**Analogs found:** 0 / 17 — greenfield repository, no existing codebase to mine

## Greenfield Notice

This is the first implementation phase of a brand-new repository. `ls` of the project root confirms only `.claude/`, `.git/`, and `.planning/` exist — no `server/`, `client/`, or any source code has been written yet. There are **no existing files, no established conventions, and no prior analogs** to extract patterns from.

Consequently, this PATTERNS.md does **not** contain "copy from existing file X" guidance. Instead it:
1. Classifies every file this phase is expected to create (per CONTEXT.md decisions and RESEARCH.md's Recommended Project Structure).
2. Points the planner directly at the concrete code excerpts already synthesized in `01-RESEARCH.md`'s Architecture Patterns section (1-6), which serve as the de facto reference implementation since no in-repo analog exists.
3. Flags every file as `no-analog` so the planner knows to treat RESEARCH.md's Architecture Patterns as the canonical source of imports/structure/error-handling conventions, and to itself become the analog baseline for Phase 2+.

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|-----------------|----------------|
| `server/src/modules/auth/crypto.ts` | utility | transform | — none — | no-analog |
| `server/src/modules/auth/session.ts` | service | event-driven | — none — | no-analog |
| `server/src/modules/auth/vaultMeta.ts` | service | file-I/O | — none — | no-analog |
| `server/src/modules/auth/totp.ts` | service | request-response | — none — | no-analog |
| `server/src/modules/auth/routes.ts` | route | request-response | — none — | no-analog |
| `server/src/modules/db/connection.ts` | service | file-I/O | — none — | no-analog |
| `server/src/modules/db/schema.ts` | model | CRUD | — none — | no-analog |
| `server/src/middleware/bindLocalhost.ts` | middleware | request-response | — none — | no-analog |
| `server/src/middleware/errorHandler.ts` | middleware | request-response | — none — | no-analog |
| `server/src/middleware/validate.ts` | middleware | request-response | — none — | no-analog |
| `server/src/app.ts` | config | request-response | — none — | no-analog |
| `client/src/features/vault-unlock/InitScreen.tsx` | component | request-response | — none — | no-analog |
| `client/src/features/vault-unlock/UnlockScreen.tsx` | component | request-response | — none — | no-analog |
| `client/src/features/vault-unlock/NoRecoveryWarningModal.tsx` | component | request-response | — none — | no-analog |
| `client/src/features/vault-2fa/EnrollScreen.tsx` | component | request-response | — none — | no-analog |
| `client/src/features/vault-2fa/DisableWithReauthScreen.tsx` | component | request-response | — none — | no-analog |
| `client/src/lib/session-signals.ts` | utility | event-driven | — none — | no-analog |

Test files (e.g. `server/src/modules/auth/crypto.test.ts`, `session.test.ts`) are also expected per the stack (`vitest`) but have no analog either — planner should establish the first test-file convention here, to be reused as the analog for all later phases.

## Pattern Assignments

Since no codebase analog exists, "pattern assignment" for this phase means: use the exact code already designed in RESEARCH.md as the starting point. Below, each target file is mapped to the specific RESEARCH.md section/excerpt that should seed it.

### `server/src/modules/auth/crypto.ts` (utility, transform)

**Source of truth:** `01-RESEARCH.md` → Architecture Patterns → **Pattern 1: Envelope Encryption, Adapted Server-Side** (full code block, lines ~194-223 of RESEARCH.md).

Key excerpt to carry over verbatim (KDF params + wrap/unwrap):
```typescript
const KDF_PARAMS = { type: argon2.argon2id, memoryCost: 131072, timeCost: 3, parallelism: 4, hashLength: 32, raw: true as const };

export async function deriveMasterKey(password: string, salt: Buffer): Promise<Buffer> {
  return argon2.hash(password, { ...KDF_PARAMS, salt }) as Promise<Buffer>;
}

export function wrapVaultKey(vaultKey: Buffer, masterKey: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(vaultKey), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function unwrapVaultKey(wrapped, masterKey: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", masterKey, wrapped.iv);
  decipher.setAuthTag(wrapped.authTag);
  return Buffer.concat([decipher.update(wrapped.ciphertext), decipher.final()]);
}
```
**Critical constraint:** `raw: true` disables `argon2.verify()` (Pitfall 1) — do not add a separate verify-hash path; the AES-GCM auth-tag mismatch throw IS the password-correctness oracle. Catch it and translate to the generic "Unable to unlock" error (never a distinguishable message).

---

### `server/src/modules/auth/vaultMeta.ts` (service, file-I/O)

**Source of truth:** RESEARCH.md → **Pattern 2: `vault.meta.json` Sidecar Schema**.

Carry over the `VaultMeta` TypeScript interface verbatim (fields: `version`, `createdAt`, `noRecoveryAcknowledged`, `kdf.{type,memoryCost,timeCost,parallelism,saltB64}`, `wrappedVaultKey.{ciphertextB64,ivB64,authTagB64}`, `totp.{enabled,wrappedSecret,backupCodeHashes}`).

**Write pattern:** temp-file-then-atomic-rename (`fs.writeFileSync(tmp)` + `fs.renameSync(tmp, final)`) to avoid torn writes corrupting the only path back into the vault. No analog exists for this in-repo; this is the first file-I/O module and should itself become the atomic-write convention for later phases.

---

### `server/src/modules/db/connection.ts` (service, file-I/O)

**Source of truth:** RESEARCH.md → **Pattern 3: Opening/Creating `vault.db`** and **Pattern 4: Kysely Over the Encrypted Connection**.

```typescript
export function openVaultDb(path: string, vaultKey: Buffer) {
  const db = new Database(path);
  db.pragma("cipher='sqlcipher'");
  db.key(vaultKey);
  db.pragma("user_version"); // forces key validation — wrap in try/catch
  return db;
}
```
**Critical ordering constraint (Pitfall 3):** open → `pragma('cipher=...')` → `.key(Buffer)` → forcing read. Never reorder; never run any other statement before `.key()`. Wrap the forcing read in try/catch and map any failure to the same generic unlock-failure response as the AES-GCM path.

---

### `server/src/modules/auth/session.ts` (service, event-driven)

**Source of truth:** RESEARCH.md → **Pattern 5: Session / Auto-Lock (Server-Authoritative)** — full code block.

```typescript
let vaultKey: Buffer | null = null;
let db: KyselyInstance | null = null;
let idleTimer: NodeJS.Timeout | null = null;
const IDLE_MS = 5 * 60_000;

export function armIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(lock, IDLE_MS);
}

export function lock() {
  if (vaultKey) vaultKey.fill(0);
  vaultKey = null;
  db?.destroy?.();
  db = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

export function isUnlocked() { return vaultKey !== null; }
```
**Critical constraint (D-03, Pitfall 4):** `lock()` must zero the buffer (`.fill(0)`) AND close the DB connection AND clear the timer, all in the same function — never split across separate steps that could be partially skipped. `armIdleTimer()` must be called from middleware on every authenticated `/api/vault/*` request (activity-based reset).

---

### `server/src/modules/auth/totp.ts` (service, request-response)

**Source of truth:** RESEARCH.md → **Pattern 6: otplib Enrollment/Verify Flow**.

```typescript
const secret = generateSecret();
const uri = generateURI({ issuer: "PersonalAssistant", label: "vault", secret });
const qrDataUrl = await QRCode.toDataURL(uri);
// ...
const result = await verify({ secret: pendingSecret, token: totpCode, epochTolerance: 30 });
if (!result.valid) return generic401();
```
**Critical gotcha:** `verify()` returns `{ valid: boolean }`, not a bare boolean — `if (await verify(...))` is always truthy and silently accepts wrong codes. Always check `.valid` explicitly.

**Backup codes:** SHA-256-hash each before persisting to `vault.meta.json` (not Argon2 — codes are already high-entropy/single-use, per Don't Hand-Roll table). Return plaintext codes exactly once in the enrollment response body, never persisted, never re-servable.

---

### `server/src/modules/auth/routes.ts` (route, request-response)

**Source of truth:** RESEARCH.md → **Common Pitfall 2: Two-step unlock creates a password-guessing oracle** + System Architecture Diagram.

**Critical constraint (Assumption A3, locked via CONTEXT.md D-06 framing):** Single endpoint `POST /api/vault/unlock { masterPassword, totpCode }` accepting both fields together when `totpEnabled` is true (client learns `totpEnabled` from a separate non-secret `GET /api/vault/status`). Return exactly one generic failure message ("Unable to unlock") regardless of which check failed — wrong password, missing/wrong TOTP, or corrupted vault. Never a response shape like `{ passwordValid: true, totpRequired: true }`.

Expected route surface: `POST /vault/init`, `POST /vault/unlock`, `POST /vault/lock`, `GET /vault/status`, `POST /vault/2fa/enroll`, `POST /vault/2fa/verify-enroll`, `POST /vault/2fa/disable` (requires re-auth per D-06).

---

### `server/src/middleware/bindLocalhost.ts` (middleware, request-response)

**Source of truth:** CONTEXT.md D-02 + RESEARCH.md Security Domain table (V9 Communication).

No code excerpt exists yet in RESEARCH.md for this specific file — it's implied infrastructure. Planner/implementer should have `app.listen(port, '127.0.0.1', ...)` and add a startup-time assertion/test that the bound address is `127.0.0.1`, never `0.0.0.0`, per PITFALLS.md Pitfall 5. This is a **no-analog, no-excerpt** file — first-of-its-kind, straightforward to implement directly from the constraint.

---

### `server/src/middleware/errorHandler.ts` (middleware, request-response)

**Source of truth:** CONTEXT.md D-02 ("never log the master password or derived key at any level") + RESEARCH.md Security Domain (V7 Error Handling and Logging) + Known Threat Patterns table.

No concrete code excerpt provided in RESEARCH.md; implement a global Express error handler that strips/redacts any field that could carry secret material (password, derived key buffers, TOTP secret) before any `console.log`/logger call, and returns the generic "Unable to unlock" (or equivalent generic message) for auth-path errors specifically.

---

### `server/src/middleware/validate.ts` (middleware, request-response)

**Source of truth:** RESEARCH.md Standard Stack table (`zod` 4.4.3) — "Validate every request body into the local API (init/unlock/2FA payloads)."

No concrete code excerpt in RESEARCH.md; standard zod-schema-per-route validation middleware pattern (parse `req.body` against a zod schema, 400 on failure) — implement directly, no analog needed given zod's own idiomatic usage.

---

### `client/src/features/vault-unlock/*.tsx`, `client/src/features/vault-2fa/*.tsx`

**Source of truth:** RESEARCH.md System Architecture Diagram (Browser tier box) + CONTEXT.md specifics ("loud/unmissable" no-recovery warning; single-step unlock form with TOTP field rendered alongside password whenever `totpEnabled: true`).

No code excerpts exist for these — RESEARCH.md deliberately keeps the browser tier to "renders forms, holds NO key material." Implementer has full discretion on component structure; the load-bearing constraint is behavioral, not structural: password field must never be logged/persisted client-side, and the TOTP field must render pre-emptively (not after a separate "password OK" round trip) per Pitfall 2.

---

### `client/src/lib/session-signals.ts` (utility, event-driven)

**Source of truth:** RESEARCH.md Pattern 5 closing note + D-04.

`beforeunload`/`pagehide`/`visibilitychange` handlers should `fetch('/api/vault/lock', {method:'POST', keepalive:true})` proactively. Explicitly a **UX accelerant only** — the server's own idle timer (session.ts) is the actual security guarantee; this file must never be treated as the enforcement point.

## Shared Patterns

### Generic Error Response ("Unable to unlock")
**Source:** RESEARCH.md Common Pitfall 2, Pattern 1, Pattern 3
**Apply to:** `routes.ts` (unlock handler), `crypto.ts` (auth-tag mismatch catch), `connection.ts` (forcing-read catch), `totp.ts` (verify failure)
All four failure sources (wrong password, wrong TOTP, corrupted DB key, tag mismatch) must collapse to the exact same generic message/status code so no endpoint response leaks which check failed.

### Key Zeroing on Lock
**Source:** RESEARCH.md Pattern 5, Pitfall 4
**Apply to:** `session.ts` lock(), any future module holding key material
`buffer.fill(0)` before dropping the reference; never rely on GC alone; close DB handle in the same synchronous call as the zeroing, not a separate step.

### Localhost-Only Binding
**Source:** CONTEXT.md D-02, RESEARCH.md Security Domain V9
**Apply to:** `app.ts`, `bindLocalhost.ts`
Bind explicitly to `127.0.0.1`; verify via automated startup check, not convention alone.

### Zod Validation on Every Request Body
**Source:** RESEARCH.md Standard Stack (zod)
**Apply to:** `routes.ts` handlers via `validate.ts` middleware — init/unlock/2fa payloads.

## No Analog Found

All 17 files listed above have no existing codebase analog (greenfield repository — first phase). RESEARCH.md's Architecture Patterns section (Patterns 1-6) is the substitute reference the planner should cite in place of "copy from file X."

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| all 17 files listed in File Classification | various | various | No prior source code exists in this repository; this phase establishes the first conventions |

## Metadata

**Analog search scope:** Entire repository root (`.`) — confirmed via `ls` that only `.claude/`, `.git/`, `.planning/` exist; no `server/` or `client/` source tree present.
**Files scanned:** 0 source files (none exist)
**Pattern extraction date:** 2026-08-18
**Note for planner:** Because this is Phase 1 of a greenfield project, the files this phase creates (especially `crypto.ts`, `session.ts`, `connection.ts`, `routes.ts`) will themselves become the analogs that later phases' pattern-mapping agents reference. Recommend keeping their structure/conventions (import style, error-handling shape, module-scoped singleton pattern in `session.ts`) intentionally clean and consistent, since Phase 2+ will copy from them directly.
</content>
