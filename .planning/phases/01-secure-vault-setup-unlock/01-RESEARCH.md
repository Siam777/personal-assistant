# Phase 1: Secure Vault Setup & Unlock - Research

**Researched:** 2026-08-18
**Domain:** Server-mediated envelope encryption (Argon2id + AES-256-GCM key wrapping), whole-DB-file encryption (better-sqlite3-multiple-ciphers), TOTP 2FA (otplib v13), Express local API design
**Confidence:** MEDIUM-HIGH (core library APIs confirmed via Context7 official docs this session; version/registry facts confirmed via live npm registry lookups; schema/route architecture is a reasoned synthesis grounded in those verified facts — flagged in Assumptions Log)

## Summary

This phase builds the cryptographic and session foundation every later phase depends on. Per D-01 (locked), all crypto happens **server-side** in the Node/Express process: Argon2id derives a Master Key from the master password, which unwraps (AES-256-GCM) a randomly-generated Vault Key, which in turn is the raw binary key handed to `better-sqlite3-multiple-ciphers` to decrypt/encrypt the entire SQLite vault file. The browser never touches key material — it only submits the master password over `127.0.0.1`-only HTTP and renders what the server returns.

The single most load-bearing implementation detail this research surfaces: **KDF salt, Argon2 parameters, and the wrapped Vault Key cannot live inside the encrypted SQLite file itself** (better-sqlite3-multiple-ciphers encrypts the whole file, page 1 onward — there is no partial-plaintext-table option). They must live in a small unencrypted sidecar file (`vault.meta.json`) containing only non-secret KDF metadata and ciphertext blobs — never plaintext secrets, satisfying SEC-05. Second: `argon2.hash({raw: true})` (required for key derivation) **disables `argon2.verify()`** — master-password correctness must instead be proven by whether the AES-256-GCM auth tag on the wrapped Vault Key validates, which conveniently also removes the need for a separate password-verifier field entirely. Third: **the installed Node.js on this machine (20.19.6) is below the `>=22` engine requirement** of `better-sqlite3-multiple-ciphers@13.0.3` and `kysely@0.29.5` — this blocks `npm install` today and must be resolved in Wave 0, either by upgrading Node or pinning older, Node-20-compatible releases of both packages (both exist and are current).

**Primary recommendation:** Use a two-file vault layout (`vault.meta.json` sidecar for KDF/wrapping metadata + `vault.db` for the whole-file-encrypted SQLite vault), a single Argon2id raw-mode KDF call per unlock (no duplicate "auth verifier" hash), AES-256-GCM auth-tag validation as the sole password-correctness oracle, and a single-step unlock request (password + TOTP code submitted together, one generic failure message) to avoid creating a password-guessing oracle via a two-step "now enter your code" response.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Crypto is server-mediated (Node-side), not zero-knowledge/browser-side. The local Node API process performs Argon2id key derivation and manages whole-DB-file encryption via `better-sqlite3-multiple-ciphers`. Do not follow `ARCHITECTURE.md`'s browser-side crypto/zero-knowledge design or its Next.js API-route structure for the crypto boundary. Reversibility: one-way.
- **D-02:** Bind the local API strictly to `127.0.0.1` (never `0.0.0.0`); never log the master password or derived key at any level; hold the derived Master/Vault key only in server-process memory for the unlocked session, zeroed on lock; re-derive on each unlock rather than persisting it.
- **D-03:** Idle timeout is 5 minutes. On timeout, the derived key must be actually zeroed/dropped from memory (not just a UI route change to a lock screen).
- **D-04:** Also lock on tab/window close and extended backgrounding (Claude's discretion, applied per pitfalls guidance). Reversibility: reversible.
- **D-05:** Hard no-recovery, with a loud/unmissable warning at vault creation ("There is no password reset. Losing this password means losing all data."). No recovery-key mechanism exists in this phase. Reversibility: costly.
- **D-06:** TOTP 2FA is an optional add-on offered after initial vault setup (not forced during first-run), configurable later from settings. Enrollment generates one-time backup codes, shown once. The TOTP secret must be encrypted at the same standard as vault secrets (never plaintext). Full re-authentication (master password) is required to view/reset/disable 2FA.

### Claude's Discretion

- Exact KDF cost parameters (Argon2id memory/iterations/parallelism) — tune per OWASP 2024+ minimums, higher since this is a single-user local app with no server-cost constraint, targeting ~0.5-1s unlock latency.
- Master password strength enforcement mechanism (entropy check vs. length minimum vs. zxcvbn-style meter) — apply a minimum strength check at creation, warn/block on weak choices.
- Exact backup-code format/count for TOTP (e.g., 10 single-use alphanumeric codes) — standard practice, no strong user preference expressed.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEC-01 | User can set a master password that derives the vault's encryption key (Argon2id KDF + AES-256-GCM envelope encryption) | Envelope Encryption pattern below; node-argon2 raw-mode API; `vault.meta.json` schema; Node `crypto` AES-256-GCM wrapping example |
| SEC-02 | User can unlock the vault by entering the correct master password | Unlock flow + route shape below; AES-GCM auth-tag-as-verifier pattern; generic-error pitfall avoidance |
| SEC-03 | User can enable optional TOTP-based 2FA on top of the master password | otplib v13 functional API; single-step unlock (password+TOTP together) to avoid oracle; backup-codes pattern |
| SEC-04 | Vault automatically locks after a period of inactivity, destroying the in-memory session key (not just hiding the UI) | Session/Auto-Lock pattern below; server-authoritative timer design; key-zeroing code example |
| SEC-05 | No plaintext secret, derived key, or master password is ever written to disk, logs, or localStorage/sessionStorage | `vault.meta.json` contains only ciphertext+non-secret metadata; logging/error-handling guidance; Don't Hand-Roll table |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Master password entry / unlock form | Browser (React) | — | Pure UI; submits password over `fetch` to the local API, never processes it |
| Argon2id KDF + AES-256-GCM key wrap/unwrap | API / Backend (Express, Node process memory) | — | D-01 locked decision: crypto is server-mediated, not browser-side |
| Vault Key custody (unlocked session) | API / Backend (Node process memory, module-scoped) | — | Never serialized to browser storage; server process is the trust boundary now (adapted from ARCHITECTURE.md's "browser JS variable" pattern) |
| Whole-DB-file encryption (vault.db) | Database / Storage (better-sqlite3-multiple-ciphers) | API / Backend (keys the connection) | Page-level encryption happens inside the native SQLite extension; the API layer supplies the raw key each time it opens the file |
| KDF salt / wrapped Vault Key / TOTP ciphertext metadata | Database / Storage (`vault.meta.json` sidecar file) | API / Backend (reads/writes it) | Must live outside the encrypted DB file (chicken-and-egg: you need the Vault Key to open the DB, but the wrapped Vault Key can't be stored inside the thing it unlocks) |
| Idle-timer / auto-lock enforcement | API / Backend (server-authoritative timer) | Browser (UX accelerant: visibility/beforeunload hooks call `/lock` proactively) | Server must independently enforce lock regardless of client signals — client hooks are UX only, never the security boundary |
| TOTP secret generation/verification, backup codes | API / Backend (otplib, Node `crypto` for hashing) | — | Secret must never leave the server unencrypted except transiently to render the enrollment QR code to the same local user |
| QR code rendering for 2FA enrollment | API / Backend (generates data URL) → Browser (renders `<img>`) | — | `qrcode.toDataURL()` runs server-side on the otpauth:// URI; browser only displays the resulting image |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | **Installed: 20.19.6** — see Environment Availability (blocker) | Runtime for local backend | `better-sqlite3-multiple-ciphers@13.0.3` and `kysely@0.29.5` require Node `>=22`. STACK.md's 24.x LTS recommendation still applies as the target; see fallback options below. `[CITED: npm registry engines field]` |
| Express | 5.2.1 | Local backend HTTP API (bind `127.0.0.1` only) | Verified current on npm registry, `engines: {node: ">=18"}`, created 2010, ~110M weekly downloads. `[CITED: npm registry]` |
| better-sqlite3-multiple-ciphers | **13.0.3** (needs Node ≥22) or **12.11.1** (Node 20.x-26.x, same release date) | Whole-file-encrypted SQLite vault | Confirmed maintained fork adding SQLCipher/SQLite3MultipleCiphers page-level encryption; `.key(Buffer)`/`.pragma('cipher=...')` API confirmed via Context7 docs. `[CITED: Context7 /m4heshd/better-sqlite3-multiple-ciphers]` `[CITED: npm registry]` |
| argon2 (node-argon2) | 0.45.1 | Key derivation from the master password | `hash({raw:true})` returns a 32-byte Buffer suitable directly as an AES-256 key; created 2015, ~1.7M weekly downloads, prebuilt binaries since v0.26.0. `[CITED: Context7 /ranisalt/node-argon2]` `[CITED: npm registry]` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| otplib | 13.4.1 | TOTP 2FA generation/verification | v13 **functional API**: top-level `generateSecret()`, `generate({secret})`, `verify({secret, token, epochTolerance})`, `generateURI({issuer, label, secret})`. **`verify()` returns a `VerifyResult` object with a `.valid` boolean field, not a raw boolean** — check `.valid`, not truthiness of the return value. `[CITED: Context7 /yeojz/otplib]` |
| qrcode | 1.5.4 | Render the otpauth:// URI as a QR code for 2FA enrollment | `QRCode.toDataURL(uri)` returns `Promise<string>` (base64 PNG data URI); pair directly with otplib's `generateURI()` output. `[CITED: Context7 /soldair/node-qrcode]` |
| Kysely | **0.29.5** (needs Node ≥22) or **0.28.7** (Node ≥20.0.0) | Type-safe SQL query builder over the vault DB | `SqliteDialectConfig` only requires a `database` object satisfying a minimal structural interface (`close()`, `prepare()` → `{reader, all, run, iterate}`) — **no package-name check, so `better-sqlite3-multiple-ciphers`'s `Database` instance can be passed directly with no `package.json` alias trick**, resolving the caveat STACK.md flagged. `[CITED: Context7 /kysely-org/kysely]` |
| zod | 4.4.3 | Runtime schema validation | Validate every request body into the local API (init/unlock/2FA payloads). `[CITED: npm registry]` |
| Node `crypto` (built-in) | Node 20/22/24.x | AES-256-GCM envelope encryption (Master Key wraps Vault Key), CSPRNG salts/IVs | `createCipheriv('aes-256-gcm', key, iv)` with a 12-byte IV; `cipher.getAuthTag()` returns a 16-byte tag by default; `decipher.setAuthTag(tag)` must be called before `decipher.final()`, which throws on tag mismatch — this throw is the password-correctness oracle. `[CITED: nodejs.org/api/crypto.html via WebSearch]` |
| `@zxcvbn-ts/core` + `@zxcvbn-ts/language-common` + `@zxcvbn-ts/language-en` | 4.2.0 (core) | Master password strength meter/enforcement (Claude's discretion item) | Actively maintained TS fork of Dropbox's `zxcvbn`; repo `github.com/zxcvbn-ts/zxcvbn`, ~1.1M weekly downloads on `@zxcvbn-ts/core`, package created 2021. **Do not confuse with the unscoped `zxcvbn-ts` package** (different, unrelated, low-download, non-org-repo package created 2026-03 — see Package Legitimacy Audit). `[CITED: npm registry]` |
| express-rate-limit | 8.6.2 | Lightweight in-memory backoff on `/api/vault/unlock` (recommended, not required) | Optional defense-in-depth for repeated failed unlock attempts; created 2014, official org repo, ~40M weekly downloads. `[ASSUMED — recommended addition beyond locked decisions, not requested by user]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Sidecar `vault.meta.json` for KDF/wrapped-key metadata | sqlite3mc's `chacha20_plaintext_header_size` partial-plaintext header | Avoids a second file, but is cipher-specific (chacha20 only, not compatible with the `sqlcipher` cipher mode recommended below), requires manual binary header parsing, and is far less documented/battle-tested for this use case. Sidecar JSON is simpler and easier to reason about for a solo build. |
| Argon2id raw-mode-only + AES-GCM-tag-as-verifier | Separate PHC-string `argon2.hash()` call purely for `argon2.verify()`-based password checking | Doubles the KDF cost per unlock (two ~0.5-1s Argon2id calls instead of one), directly contradicting the phase's own "~0.5-1s unlock latency" target, for no security benefit — the AES-GCM tag check is already a cryptographically sound correctness oracle. |
| `better-sqlite3-multiple-ciphers` cipher = `sqlcipher` (AES-256-CBC+HMAC) | Default `chacha20` cipher (ChaCha20-Poly1305 AEAD) | `chacha20` is modern, authenticated, and requires zero extra config (it's the library default) — a legitimate, arguably *more* modern choice. Recommended `sqlcipher` here only because the phase's success criteria explicitly brand the design as "AES-256-GCM" and `sqlcipher` mode is the AES-256-family, HMAC-authenticated, widely-audited option that best matches that language. Either is cryptographically sound; this is a naming/branding-consistency choice, not a security one. |

**Installation (once Node version is resolved — see Environment Availability):**
```bash
npm install express better-sqlite3-multiple-ciphers argon2 otplib qrcode kysely zod @zxcvbn-ts/core @zxcvbn-ts/language-common @zxcvbn-ts/language-en
npm install -D vite @vitejs/plugin-react typescript@6 typescript-eslint eslint vitest
```

**Version verification:** All versions above were confirmed live against the npm registry on 2026-08-18 via `npm view <pkg> version` / `time.created` / `engines` — see Package Legitimacy Audit for full signal detail. `better-sqlite3-multiple-ciphers` and `kysely` each have two viable version lines (latest, Node≥22; and an older-but-current line, Node≥20) — see Environment Availability for the decision this forces.

## Package Legitimacy Audit

| Package | Registry | Age (first published) | Weekly Downloads | Source Repo | Verdict | Disposition |
|---------|----------|------------------------|-------------------|--------------|---------|-------------|
| express | npm | 2010-12-29 (~16 yrs) | ~110M | github.com/expressjs/express | OK | Approved |
| better-sqlite3-multiple-ciphers | npm | 2021-07-25 (~5 yrs) | ~19-75k | github.com/m4heshd/better-sqlite3-multiple-ciphers | SUS (`too-new`, from latest-*version* publish date, not package age) | Flagged — planner adds `checkpoint:human-verify`; age/repo evidence above supports approval, human should confirm before locking `.13.0.3` vs `.12.11.1` |
| argon2 | npm | 2015-12-19 (~11 yrs) | ~1.7M | github.com/ranisalt/node-argon2 | SUS (`too-new`, same last-publish-date artifact) | Flagged — planner adds `checkpoint:human-verify`; age/downloads/repo evidence supports approval |
| otplib | npm | 2014-04-14 (~12 yrs) | ~2.3M | github.com/yeojz/otplib | OK | Approved |
| qrcode | npm | 2010-12-21 (~16 yrs) | ~18.8M | github.com/soldair/node-qrcode | OK | Approved |
| kysely | npm | 2021-02-18 (~5 yrs) | ~11.7M | github.com/kysely-org/kysely | SUS (`too-new`, same last-publish-date artifact) | Flagged — planner adds `checkpoint:human-verify`; age/downloads/repo evidence supports approval |
| zod | npm | 2020-03-07 (~6 yrs) | ~224M | github.com/colinhacks/zod | OK | Approved |
| `@zxcvbn-ts/core` | npm | 2021-01-05 (~5 yrs) | ~1.1M | github.com/zxcvbn-ts/zxcvbn | SUS (`too-new`, same artifact) | Flagged — planner adds `checkpoint:human-verify`. **Distinct from the unscoped `zxcvbn-ts` package** below — use the scoped `@zxcvbn-ts/*` packages only |
| `zxcvbn-ts` (unscoped) | npm | 2026-03-20 (~5 months) | ~1,933 | github.com/KunalTanwar/zxcvbn-ts (personal repo, not an org) | SUS (genuinely new + low downloads + non-org repo) | **REMOVED from recommendations** — do not install; this is a different, unrelated, unvetted package that happens to share a similar name to the legitimate `@zxcvbn-ts/*` scoped packages |
| express-rate-limit | npm | 2014-12-11 (~12 yrs) | ~40M | github.com/express-rate-limit/express-rate-limit | SUS (`too-new`, same artifact) | Flagged — planner adds `checkpoint:human-verify`; age/downloads/repo evidence supports approval |

**Packages removed due to `[SLOP]`/confusion risk:** `zxcvbn-ts` (unscoped) — namesquat-adjacent risk; use `@zxcvbn-ts/core` instead.

**Packages flagged as suspicious `[SUS]`:** `better-sqlite3-multiple-ciphers`, `argon2`, `kysely`, `@zxcvbn-ts/core`, `express-rate-limit`. **Note on these flags:** every one of them was flagged solely for `too-new`, which this project's legitimacy tool derives from the *latest version's* publish timestamp (all were republished within the last two weeks as of this research date), not the package's first-published date — each was independently cross-checked via `npm view <pkg> time.created` and shows 5-16 years of history, established GitHub org repositories, and download counts from ~19k/week to ~224M/week. This pattern (recent release + old package) is what "actively maintained" looks like, not what a supply-chain risk looks like. The planner should still insert the required `checkpoint:human-verify` tasks per protocol, but can resolve them quickly using the age/downloads/repo evidence in this table.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  BROWSER (React + Vite) — renders forms, holds NO key material   │
│  ┌────────────┐  ┌───────────────┐  ┌─────────────────────────┐  │
│  │ Init/Setup │  │ Unlock Form   │  │ 2FA Enrollment/Settings │  │
│  │ (password, │  │ (password +   │  │ (QR display, backup     │  │
│  │  ack-no-   │  │  TOTP code    │  │  codes shown once)      │  │
│  │  recovery) │  │  together)    │  │                          │  │
│  └─────┬──────┘  └──────┬────────┘  └───────────┬──────────────┘  │
└────────┼────────────────┼───────────────────────┼─────────────────┘
         │  fetch() over 127.0.0.1 only — password crosses ONCE per request, never persisted client-side
┌────────┼────────────────┼───────────────────────┼─────────────────┐
│        ▼                ▼                       ▼                 │
│  POST /vault/init   POST /vault/unlock     POST /vault/2fa/*       │
│        │                │                       │                  │
│  ┌─────▼────────────────▼───────────────────────▼──────────────┐  │
│  │              SESSION / CRYPTO MODULE (in-memory)              │  │
│  │  1. Argon2id(password, salt, params) → Master Key (raw Buffer)│  │
│  │  2. AES-256-GCM decrypt(wrappedVaultKey, MasterKey)           │  │
│  │     → tag valid?  NO → generic 401 "Unable to unlock"         │  │
│  │                   YES → Vault Key (raw Buffer, in memory)     │  │
│  │  3. (if totpEnabled) otplib.verify(totpSecret, code)           │  │
│  │     → invalid → generic 401 "Unable to unlock"                │  │
│  │  4. db.pragma("cipher=...") + db.key(VaultKey) → open vault.db │  │
│  │  5. Start/reset 5-min idle timer; arm on every request         │  │
│  └───────────────┬─────────────────────────┬─────────────────────┘  │
│                  │                         │                        │
│         ┌────────▼────────┐      ┌─────────▼──────────┐             │
│         │  vault.meta.json │      │      vault.db       │             │
│         │  (UNENCRYPTED    │      │ (WHOLE-FILE          │             │
│         │  sidecar — only  │      │  ENCRYPTED via       │             │
│         │  salts/IVs/      │      │  better-sqlite3-     │             │
│         │  ciphertext, no  │      │  multiple-ciphers,   │             │
│         │  plaintext ever) │      │  keyed with the      │             │
│         │                  │      │  raw Vault Key)      │             │
│         └──────────────────┘      └──────────────────────┘             │
│                  EXPRESS API PROCESS (127.0.0.1 only)                  │
└──────────────────────────────────────────────────────────────────────┘
```

Idle-timer firing (or `/vault/lock`, or `/vault/status` heartbeat gap) zeroes the in-memory Vault/Master Key buffers, closes the `vault.db` connection, and flips global state to locked — no decrypted data remains reachable through any code path until a fresh unlock.

### Recommended Project Structure

```
server/
├── src/
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── crypto.ts        # Argon2id KDF, AES-256-GCM wrap/unwrap helpers
│   │   │   ├── session.ts       # module-scoped Vault Key holder, idle timer, lock()/unlock()
│   │   │   ├── vaultMeta.ts     # vault.meta.json read/write (KDF params, wrapped key, TOTP blob)
│   │   │   ├── totp.ts          # otplib wrapper: enroll, verify, backup codes
│   │   │   └── routes.ts        # /api/vault/init, /unlock, /lock, /status, /2fa/*
│   │   └── db/
│   │       ├── connection.ts    # opens vault.db with the current Vault Key via Kysely
│   │       └── schema.ts        # schema_version table only in this phase (entries land in Phase 2)
│   ├── middleware/
│   │   ├── bindLocalhost.ts     # refuses to boot if not bound to 127.0.0.1
│   │   ├── errorHandler.ts      # strips any field that might carry secret material before logging
│   │   └── validate.ts          # zod request-body validation
│   └── app.ts
client/
├── src/
│   ├── features/vault-unlock/   # init screen, unlock screen, no-recovery warning modal
│   ├── features/vault-2fa/      # enrollment QR/backup-codes screen, disable-with-reauth screen
│   └── lib/session-signals.ts   # beforeunload/visibilitychange → POST /vault/lock (UX accelerant only)
```

### Pattern 1: Envelope Encryption, Adapted Server-Side

**What:** Argon2id derives a Master Key from the password + per-vault salt (never stored). A random 32-byte Vault Key is generated once at vault creation and wrapped (AES-256-GCM) by the Master Key. The wrapped Vault Key lives in `vault.meta.json`; the Vault Key itself is what keys `vault.db`.
**When to use:** Always for this phase — lets the master password change later (Vault Key stays the same, only the wrapping changes) without re-encrypting the whole database.
**Example (vault creation):**
```typescript
// server/src/modules/auth/crypto.ts
import argon2 from "argon2";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const KDF_PARAMS = { type: argon2.argon2id, memoryCost: 131072 /* 128 MiB */, timeCost: 3, parallelism: 4, hashLength: 32, raw: true as const };

export async function deriveMasterKey(password: string, salt: Buffer): Promise<Buffer> {
  // raw:true → Buffer output, required for direct use as an AES-256 key.
  // NOTE: raw:true disables argon2.verify() — see Common Pitfalls.
  return argon2.hash(password, { ...KDF_PARAMS, salt }) as Promise<Buffer>;
}

export function wrapVaultKey(vaultKey: Buffer, masterKey: Buffer) {
  const iv = randomBytes(12); // fresh CSPRNG IV every call — never reuse
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(vaultKey), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 16 bytes
  return { ciphertext, iv, authTag };
}

export function unwrapVaultKey(wrapped: { ciphertext: Buffer; iv: Buffer; authTag: Buffer }, masterKey: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", masterKey, wrapped.iv);
  decipher.setAuthTag(wrapped.authTag);
  // Throws on tag mismatch — THIS throw is the password-correctness oracle. Catch it, return generic error.
  return Buffer.concat([decipher.update(wrapped.ciphertext), decipher.final()]);
}
```
`[CITED: Context7 /ranisalt/node-argon2 + nodejs.org/api/crypto.html via WebSearch — pattern synthesis is this agent's own design, flagged in Assumptions Log]`

### Pattern 2: `vault.meta.json` Sidecar Schema

**What:** The only place KDF parameters and the wrapped Vault Key can live, since `better-sqlite3-multiple-ciphers` encrypts the entire DB file with no partial-plaintext-table option.
**Fields (all either non-secret or ciphertext — satisfies SEC-05):**
```typescript
interface VaultMeta {
  version: 1;
  createdAt: string;               // ISO timestamp
  noRecoveryAcknowledged: true;    // must be true to have completed init — enforced UX gate
  kdf: {
    type: "argon2id";
    memoryCost: number;            // e.g. 131072 (128 MiB)
    timeCost: number;              // e.g. 3
    parallelism: number;           // e.g. 4
    saltB64: string;                // 16+ random bytes, base64 — NOT secret
  };
  wrappedVaultKey: { ciphertextB64: string; ivB64: string; authTagB64: string };
  totp: {
    enabled: boolean;
    wrappedSecret: { ciphertextB64: string; ivB64: string; authTagB64: string } | null; // encrypted with Vault Key, not Master Key
    backupCodeHashes: string[];    // SHA-256 hex digests, one per unused code; consumed codes removed from array
  };
}
```
Write this file with a temp-file-then-atomic-rename pattern (`fs.writeFileSync(tmp)` + `fs.renameSync(tmp, final)`) to avoid a torn write corrupting the vault's only path back in. `[ASSUMED — design synthesis, not sourced from a single authoritative reference; see Assumptions Log]`

### Pattern 3: Opening/Creating `vault.db`

**What:** `better-sqlite3-multiple-ciphers` creates the file synchronously on `new Database(path)` if it doesn't exist. The cipher pragma and key **must** be set immediately after opening, before any other statement — including the very first `CREATE TABLE`.
**Example:**
```typescript
// server/src/modules/db/connection.ts
import Database from "better-sqlite3-multiple-ciphers";

export function openVaultDb(path: string, vaultKey: Buffer /* 32 raw bytes */) {
  const db = new Database(path); // creates the file if missing — still plaintext/unstructured at this point
  db.pragma("cipher='sqlcipher'");   // AES-256-CBC + HMAC, authenticated, matches "AES-256" branding
  db.key(vaultKey);                   // binary-safe wrapper around sqlite3_key() — use this, not PRAGMA key string form, for raw byte keys
  // First statement after key() implicitly validates the key on read; wrap in try/catch.
  db.pragma("user_version"); // cheap read to force key validation
  return db;
}
```
Order is: open → `pragma('cipher=...')` → `.key(Buffer)` → first read/write. Reversing the cipher/key order, or running any other statement before `.key()`, is the most common way this integration breaks. `[CITED: Context7 /m4heshd/better-sqlite3-multiple-ciphers, /utelle/sqlite3multipleciphers]`

**Why `.key(Buffer)` and not `PRAGMA key = '...'`:** the PRAGMA string form expects a passphrase or a SQLCipher raw-hex-key literal (`x'...'`); the `.key(Buffer)` binding wraps `sqlite3_key()` directly and is the documented path for binary byte-array keys — exactly what a 32-byte Argon2id/random Vault Key is. `[CITED: Context7 /m4heshd/better-sqlite3-multiple-ciphers]`

**Available whole-DB ciphers** (set via `PRAGMA cipher = '...'` before `.key()`): `aes128cbc`, `aes256cbc` (no documented built-in HMAC), `chacha20` (default, ChaCha20-Poly1305 AEAD), `sqlcipher` (AES-256-CBC + HMAC, recommended here), `rc4` (legacy only, do not use), `ascon128`, `aegis`. `[CITED: Context7 /utelle/sqlite3multipleciphers]`

### Pattern 4: Kysely Over the Encrypted Connection

```typescript
import { Kysely, SqliteDialect } from "kysely";

const dialect = new SqliteDialect({ database: openVaultDb(dbPath, vaultKey) }); // no package.json alias needed
const db = new Kysely<VaultDbSchema>({ dialect });
```
`[CITED: Context7 /kysely-org/kysely]`

### Pattern 5: Session / Auto-Lock (Server-Authoritative)

**What:** A module-scoped singleton (this is a single-user local app — one global vault-open state is correct, not per-browser-session state) holding the Vault Key Buffer, the open Kysely/DB handle, and a `setTimeout` idle timer that resets on every authenticated request.
**Example:**
```typescript
// server/src/modules/auth/session.ts
let vaultKey: Buffer | null = null;
let db: KyselyInstance | null = null;
let idleTimer: NodeJS.Timeout | null = null;
const IDLE_MS = 5 * 60_000;

export function armIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(lock, IDLE_MS);
}

export function lock() {
  if (vaultKey) vaultKey.fill(0);      // zero, not just null — dereferencing alone leaves bytes in the heap until GC/reuse
  vaultKey = null;
  db?.destroy?.();                      // or db.close() on the raw connection
  db = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

export function isUnlocked() { return vaultKey !== null; }
```
Call `armIdleTimer()` from a middleware that runs on every `/api/vault/*` route once unlocked (activity = any authenticated request, not just explicit ones). Client `beforeunload`/`pagehide` and `visibilitychange` handlers should `fetch('/api/vault/lock', {method:'POST', keepalive:true})` proactively (D-04) — but the server's own timer is the actual guarantee; never trust the client signal alone. `[CITED: PITFALLS.md Pitfall 3, ARCHITECTURE.md Pattern 2 — adapted from browser JS variable to Node process memory per D-01/D-02]`

### Pattern 6: otplib Enrollment/Verify Flow

```typescript
import { generateSecret, generate, verify, generateURI } from "otplib";
import QRCode from "qrcode";

// Step 1 — POST /api/vault/2fa/enroll (requires unlocked session)
const secret = generateSecret();               // base32 string
const uri = generateURI({ issuer: "PersonalAssistant", label: "vault", secret });
const qrDataUrl = await QRCode.toDataURL(uri);
// Return { secret, qrDataUrl } — hold `secret` server-side (e.g., short-lived pending-enrollment map keyed by a random id), NOT yet persisted to vault.meta.json.

// Step 2 — POST /api/vault/2fa/verify-enroll { pendingId, totpCode }
const result = await verify({ secret: pendingSecret, token: totpCode, epochTolerance: 30 });
if (!result.valid) return generic401(); // do not say "wrong code" specifically — see Pitfalls
// On success: AES-256-GCM-encrypt `secret` with the Vault Key, generate N backup codes,
// SHA-256-hash each, write both into vault.meta.json, set totp.enabled = true.
// Return the plaintext backup codes ONCE in this response body — never persisted, never re-servable.
```
`[CITED: Context7 /yeojz/otplib]` — **critical gotcha:** `verify()` returns `{ valid: boolean, ... }`, not a bare boolean; code that does `if (await verify(...))` instead of `if ((await verify(...)).valid)` will always treat the result as truthy (a non-null object) and silently accept every code, including wrong ones.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Password-to-key derivation | Custom PBKDF2/SHA-256 loop | `argon2` raw mode | Memory-hard, side-channel resistant, current best practice; already verified/wired above |
| AES-GCM encryption | Hand-rolled cipher/padding | Node `crypto` `createCipheriv('aes-256-gcm', ...)` | Auth-tag integrity is built in; rolling your own risks IV reuse or missing authentication (PITFALLS.md Pitfall 1) |
| Whole-DB encryption | Per-field manual AES calls across every table | `better-sqlite3-multiple-ciphers` page-level cipher | Guarantees folder names, tags, and every future column are encrypted by construction, not by remembering to wrap each new field |
| TOTP generation/verification | Custom HMAC-based OTP implementation | `otplib` v13 functional API | RFC 6238 compliance, clock-drift tolerance (`epochTolerance`), Google Authenticator/Authy compatibility already solved |
| Password strength scoring | A length/regex heuristic | `@zxcvbn-ts/core` | Dictionary/pattern-aware entropy estimation catches "P@ssw0rd123!" as weak despite meeting naive complexity rules |
| Backup-code hashing | Storing codes in plaintext "because they're already inside the encrypted file" | SHA-256 hash each code before persisting | Defense-in-depth against any future bug that reads `vault.meta.json` out of context (e.g., a misdirected debug log); codes are single-use/high-entropy so a fast hash (not Argon2) is appropriate |

**Key insight:** Every hand-rolled shortcut in this domain (custom KDF, custom cipher, plaintext-until-later "just for now") either directly violates SEC-05 or becomes the exact vulnerability class PITFALLS.md documents as Pitfall 1-3 — there is no part of this phase's crypto surface where a bespoke implementation is the right call.

## Common Pitfalls

### Pitfall 1: `raw: true` silently breaks `argon2.verify()`
**What goes wrong:** A developer derives the Master Key with `raw: true` (required, to get a usable AES key), then later tries `argon2.verify(storedHash, password)` somewhere for a "did they type the right password" check and it always throws or returns false, because `verify()` only understands PHC-string output, not raw buffers.
**Why it happens:** Every other guide/example uses `argon2.hash()` without `raw` for password auth; raw mode is a less-common path specific to key derivation.
**How to avoid:** Don't build a separate password-verifier field at all — use the AES-256-GCM auth-tag check on `unwrapVaultKey()` as the sole correctness oracle (Pattern 1 above). If a project ever needs both raw key derivation *and* a PHC-string check, that requires two independent Argon2id calls with different salts, which doubles unlock latency — avoid unless there's a concrete reason.
**Warning signs:** Any `argon2.verify()` call anywhere near code that also sets `raw: true`.

### Pitfall 2: Two-step unlock creates a password-guessing oracle
**What goes wrong:** UI collects the master password first, calls the server, and only on a distinct "password OK, now enter your code" response reveals the TOTP field. An attacker can then brute-force the master password offline against that response, since a wrong password and a wrong-password-with-valid-format both currently look identical from a different endpoint response — but a *correct* password with TOTP enabled will trigger a visibly different response than an *incorrect* password, which is exactly the "no distinction between wrong master password and X that reveals structural info" mistake PITFALLS.md's Security Mistakes table warns against.
**Why it happens:** It's the natural, familiar UX pattern (Google/GitHub-style sequential 2FA) and looks like better UX.
**How to avoid:** The client already knows `totpEnabled` from `GET /api/vault/status` (non-secret). Render the TOTP input field alongside the password field from the start whenever `totpEnabled: true`, and submit both in a single `POST /api/vault/unlock { masterPassword, totpCode }` request. Return exactly one generic failure ("Unable to unlock") regardless of which check failed (wrong password, missing/wrong TOTP, corrupted vault).
**Warning signs:** Two separate unlock-related endpoints, or a response shape that includes something like `{ passwordValid: true, totpRequired: true }`.

### Pitfall 3: PRAGMA cipher/key ordering, or skipping the post-key validation read
**What goes wrong:** Calling `.key()` before `.pragma('cipher=...')`, or running any query between opening the connection and calling `.key()`, silently produces an unreadable or wrongly-encrypted file. Separately, `.key()` itself does not throw on a wrong key — the failure only surfaces on the first actual read.
**Why it happens:** `new Database(path)` "succeeds" even with the wrong key or wrong pragma order — there's no immediate feedback, so the bug looks fine until the first real query fails much later (e.g., in Phase 2 when entries are added).
**How to avoid:** Always follow the exact order in Pattern 3, and immediately after `.key()` run a cheap forcing read (e.g., `db.pragma('user_version')`) wrapped in try/catch, converting any failure into the same generic "Unable to unlock" response used for the AES-GCM tag-mismatch path.
**Warning signs:** A `new Database()` + `.key()` call with no subsequent read before returning success to the caller.

### Pitfall 4: `lockTimer` cleared but key not zeroed (or vice versa)
**What goes wrong:** Auto-lock code clears the idle `setTimeout` and flips a boolean but leaves the `Buffer` holding the Vault Key referenced elsewhere (e.g., captured in a closure passed to an in-flight query), so it isn't garbage-collected or zeroed — the #1 "looks done but isn't" failure mode per PITFALLS.md.
**How to avoid:** `buffer.fill(0)` before dropping the reference (Pattern 5), and close the DB connection as part of the same `lock()` call, not a separate step that could be skipped.
**Warning signs:** Manual UAT: after triggering lock, attempt any `/api/vault/*` read via a direct HTTP call (not just checking the UI) — it must fail.

## Code Examples

Verified patterns from official sources (see full listings under Architecture Patterns above):
- Argon2id raw-mode key derivation — `[CITED: Context7 /ranisalt/node-argon2]`
- AES-256-GCM wrap/unwrap via Node `crypto` — `[CITED: nodejs.org/api/crypto.html via WebSearch]`
- `better-sqlite3-multiple-ciphers` cipher pragma + `.key(Buffer)` — `[CITED: Context7 /m4heshd/better-sqlite3-multiple-ciphers]`
- Kysely `SqliteDialect` with a custom driver instance — `[CITED: Context7 /kysely-org/kysely]`
- otplib v13 `generateSecret`/`generate`/`verify`/`generateURI` — `[CITED: Context7 /yeojz/otplib]`
- `qrcode.toDataURL()` — `[CITED: Context7 /soldair/node-qrcode]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| PBKDF2-SHA256 for password KDF | Argon2id | OWASP recommendation since ~2021, still current | Memory-hardness resists GPU/ASIC brute force; this phase already targets Argon2id per D-01/STACK.md |
| otplib `authenticator.generate/verify` (classic v12-era API) | otplib v13 functional API (`generate`, `verify`, `generateSecret`, `generateURI`) returning a `VerifyResult` object | otplib v13 | `verify()` result shape changed from boolean to object — see Pitfall 2 in Common Pitfalls (referenced above as the `.valid` gotcha) |
| `better-sqlite3-multiple-ciphers` supporting Node 20.x broadly | Latest `13.0.3` line requires Node `>=22` | Recent release (published within the last 2 weeks of this research date) | Forces a Node-version decision in Wave 0 — see Environment Availability |

**Deprecated/outdated:** PBKDF2 as a *first choice* for new password-KDF work (still acceptable as a documented fallback if Argon2id is genuinely unavailable, per PITFALLS.md, but not applicable here since `argon2` installs cleanly on this stack).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | KDF salt, Argon2 params, and wrapped Vault Key must live in a separate unencrypted sidecar file (`vault.meta.json`) rather than inside `vault.db` or a plaintext DB header | Architecture Patterns 2-3 | This is reasoned from verified constraints (whole-file page-level encryption, no partial-plaintext-table support) but the specific "JSON sidecar file" implementation choice itself is this agent's design synthesis, not sourced from an authoritative reference describing this exact vault's architecture. If wrong, the DB-open bootstrap sequence needs restructuring, but the underlying crypto (Argon2id/AES-GCM) is unaffected. |
| A2 | AES-256-GCM auth-tag validation alone is a sufficient, secure "correct master password" oracle, replacing a separate password-verifier hash | Architecture Pattern 1, Pitfall 1 | Cryptographically sound (GCM's tag is a MAC over the ciphertext, keyed by the candidate Master Key) but is a design choice, not a decision the user explicitly made. If a future phase needs to check password correctness *without* unwrapping the Vault Key (unlikely), this would need revisiting. |
| A3 | Single-step unlock (password + TOTP submitted together, one generic error) is required to avoid a password-guessing oracle, over the more common two-step "enter password, then enter code" UX | Common Pitfalls #2 | If implemented as two-step instead, the vulnerability is subtle (an attacker distinguishing "wrong password" from "right password, needs code" responses) — moderate risk if missed, should be confirmed with the user or explicitly decided by the planner before implementation. |
| A4 | `cipher='sqlcipher'` (AES-256-CBC+HMAC) is the recommended whole-DB cipher mode over the library's `chacha20` default | Alternatives Considered, Architecture Pattern 3 | Purely a branding/consistency choice to match the success criteria's "AES-256-GCM" language; `chacha20` (the actual library default) is equally or more modern/secure. Low risk either way — reversible by changing one pragma string before first vault creation (not reversible after real vaults exist, without a re-key). |
| A5 | Node 20 vs Node 22+ decision and the specific fallback package-version pins (`better-sqlite3-multiple-ciphers@^12.11.1`, `kysely@^0.28.7`) | Environment Availability | If the planner/user prefers upgrading Node instead, these pinned versions are unnecessary — but if Node stays at 20.x, these specific pins are load-bearing and must not silently drift to a Node≥22-only version during `npm install`. |
| A6 | Argon2id starting parameters of `memoryCost=131072 (128 MiB), timeCost=3, parallelism=4` will land near the ~0.5-1s target | Standard Stack, Architecture Pattern 1 | Actual timing is hardware-dependent; needs a benchmark step in Wave 0 on the real target machine, not just trusting these numbers. |

**If this table is empty:** N/A — see entries above; all are either reasoned syntheses from verified facts or explicit hardware/preference-dependent tuning that needs a lightweight confirmation step, not blocking research gaps.

## Open Questions

1. **Should Node be upgraded to 22+/24.x, or should the phase pin the Node-20-compatible package versions?**
   - What we know: Installed Node is 20.19.6. `better-sqlite3-multiple-ciphers@12.11.1` and `kysely@0.28.7` both support Node 20.x today and are current, actively-maintained releases (not stale forks). `better-sqlite3-multiple-ciphers@13.0.3` and `kysely@0.29.5` require Node ≥22.
   - What's unclear: Whether there's a project-level reason to want the absolute-latest package versions (STACK.md recommended 24.x LTS for other reasons too — Tauri sidecar path, `node:sqlite` availability).
   - Recommendation: Default to upgrading Node to 24.x LTS in Wave 0 (matches STACK.md, avoids carrying version-pin debt) unless the user has a reason to avoid a Node upgrade right now, in which case pin the two packages to their Node-20-compatible lines.

2. **Does 2FA enrollment (turning TOTP on for the first time) require full password re-authentication, or is "already unlocked" sufficient?**
   - What we know: D-06 explicitly requires full re-auth to "view/reset/disable" 2FA. It does not explicitly say enrollment (first-time turn-on) requires re-auth beyond an active unlocked session.
   - What's unclear: Whether the user intended enrollment to also require a fresh password prompt (defense-in-depth against a walked-away-from-unlocked-session scenario) or considered "already unlocked" sufficient since the session itself already proves recent authentication.
   - Recommendation: Require re-auth only for disable/backup-code-regeneration (as explicitly stated in D-06); treat "unlocked" as sufficient for initial enrollment. Flag this reading to the user during planning if there's any ambiguity.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js ≥22 (24.x LTS ideal) | `better-sqlite3-multiple-ciphers@13.0.3`, `kysely@0.29.5` | ✗ (installed: 20.19.6) | 20.19.6 installed | Pin `better-sqlite3-multiple-ciphers@^12.11.1` + `kysely@^0.28.7` (both support Node 20.x, both current/maintained) |
| Node.js native build toolchain (for `argon2`, `better-sqlite3-multiple-ciphers` prebuild fallback) | `argon2`, `better-sqlite3-multiple-ciphers` | Not probed this session (Windows dev box) | — | If prebuilt binaries aren't available for the resolved Node/arch combo, requires Visual Studio 2015+ Build Tools + node-gyp; verify with a plain `npm install` dry run in Wave 0 before assuming it "just works" |
| npm | Package installation | ✓ | 10.8.2 | — |
| git | Version control | ✓ | 2.52.0 | — |

**Missing dependencies with no fallback:**
- None — Node version gap has a documented, viable fallback (pin older package lines).

**Missing dependencies with fallback:**
- Node.js ≥22 — see table above; resolve explicitly in Wave 0 before any `npm install` of the core stack, since installing today with Node 20.19.6 against the latest package versions will fail the `engines` check (or worse, `npm install --force`/`--engine-strict=false` silently past it and fail at native-module load time instead).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|-------------------|
| V2 Authentication | Yes | Master password (Argon2id-derived key) + optional TOTP (otplib, RFC 6238) as a second factor layered on top, never a replacement |
| V3 Session Management | Yes | Server-side in-memory session (Vault Key), 5-minute idle timeout with actual key zeroing, no session token persisted client-side beyond the localhost-only `fetch` calls themselves |
| V4 Access Control | Partial | Single-user local app — no multi-user authorization model needed; the only "access control" is unlocked-vs-locked global state gating `/api/vault/*` routes |
| V5 Input Validation | Yes | `zod` schemas on every request body (`init`, `unlock`, `2fa/*`) |
| V6 Cryptography (Stored Cryptography) | Yes | Argon2id KDF (never hand-rolled), AES-256-GCM (Node `crypto`, authenticated, fresh CSPRNG IV per operation), whole-DB AES-256/ChaCha20-Poly1305 page cipher (`better-sqlite3-multiple-ciphers`) — no custom cipher/KDF anywhere in this phase |
| V7 Error Handling and Logging | Yes | Generic "Unable to unlock" for every unlock-path failure; global error handler must strip password/key fields before any log write |
| V9 Communication | Partial | Bind strictly to `127.0.0.1` (D-02); no TLS needed for a loopback-only local API, but this must be enforced/tested at startup, not just assumed by convention |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Offline brute-force of the master password against a stolen `vault.meta.json` + `vault.db` pair | Elevation of Privilege | Argon2id with tuned high-cost parameters (memory-hard, resists GPU parallelization); see Assumption A6 for benchmark step |
| Password-guessing oracle via distinguishable unlock responses (2FA-required vs wrong-password) | Information Disclosure | Single-step unlock, one generic error (Common Pitfall #2 / Assumption A3) |
| IV/nonce reuse in AES-256-GCM wrapping | Tampering (catastrophic — can leak the auth key) | Fresh `randomBytes(12)` IV on every `wrapVaultKey`/`rekey` call, never cached or derived deterministically |
| Local API bound beyond loopback, reachable by other processes/malware on the same machine | Spoofing / Information Disclosure | Bind explicitly to `127.0.0.1`, verified by an automated startup check/test (D-02, PITFALLS.md Pitfall 5) |
| Sensitive data (password, derived key, TOTP secret) reaching logs or error responses | Information Disclosure | Global error-handler redaction; lint/review rule against `console.log` of request bodies or key buffers on the auth module (PITFALLS.md Pitfall 7) |
| TOTP secret stored weaker than the rest of the vault (the "2FA becomes the weak link" mistake) | Tampering / Elevation of Privilege | TOTP secret encrypted with the Vault Key via the same AES-256-GCM helper as everything else, never a separate/weaker scheme (D-06, PITFALLS.md Security Mistakes table) |

## Sources

### Primary (HIGH confidence — direct tool verification this session)
- npm registry (`npm view <pkg> version/time.created/engines`) — live version, age, and Node-engine checks for all 11 packages discussed, 2026-08-18
- `gsd_run query package-legitimacy check` — automated legitimacy signals for all 11 packages, cross-checked manually against `time.created`/repo/downloads

### Secondary (MEDIUM confidence — Context7 official docs, cited)
- Context7 `/ranisalt/node-argon2` — raw-mode output, `verify()` incompatibility with raw mode, salt defaulting, high-security parameter example
- Context7 `/yeojz/otplib` — v13 functional API shape, `VerifyResult.valid`, `epochTolerance`, enrollment flow example
- Context7 `/m4heshd/better-sqlite3-multiple-ciphers` — `new Database()`, `.pragma()`, `.key(Buffer)`/`.rekey(Buffer)`, cipher-then-key ordering
- Context7 `/utelle/sqlite3multipleciphers` — available cipher list, `sqlcipher` = AES-256-CBC+HMAC, `chacha20` default, PRAGMA-based cipher configuration
- Context7 `/kysely-org/kysely` — `SqliteDialectConfig`/`SqliteDatabase` structural interface, no package-name dependency
- Context7 `/soldair/node-qrcode` — `toDataURL()` signature and options
- WebSearch: nodejs.org/api/crypto.html-sourced summary of `createCipheriv`/`getAuthTag`/`setAuthTag` for AES-256-GCM

### Tertiary (LOW-MEDIUM confidence — WebSearch only, cross-checked where noted)
- WebSearch: OWASP Argon2id minimum parameters (cross-checked against node-argon2's own docs high-security example — converges)
- WebSearch: node-argon2 Windows prebuilt-binary/node-gyp build-from-source requirements
- WebSearch: `better-sqlite3-multiple-ciphers` maintenance cadence (single-source, used only to corroborate the registry-verified facts)
- WebSearch: TOTP backup-code generation/hashing best practice (single-source aggregation, standard/uncontroversial guidance)
- Project-level research docs already read in full and built upon, not re-cited per claim: `.planning/research/STACK.md`, `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md`

## Metadata

**Confidence breakdown:**
- Standard stack (library choices/versions): HIGH — every package version/age/engines fact confirmed live against the npm registry this session
- Architecture (envelope encryption, sidecar file, route shapes): MEDIUM — core crypto primitives are Context7-verified; the specific two-file vault layout and route design are this agent's reasoned synthesis (see Assumptions Log A1-A4), grounded in verified constraints but not themselves sourced from an external authority
- Pitfalls: HIGH for the crypto-library-specific gotchas (raw-mode/verify incompatibility, PRAGMA ordering) — directly observed in official docs; MEDIUM for the two-step-unlock-oracle pitfall, which is this agent's own security reasoning applied to the locked decisions, not a cited external source

**Research date:** 2026-08-18
**Valid until:** ~30 days for the architecture/pitfalls guidance (stable domain); ~7-14 days for the specific package version numbers given `better-sqlite3-multiple-ciphers` and `kysely` are both mid-major-version-bump and releasing frequently — re-verify versions/engines immediately before Wave 0 `npm install` if planning is delayed
