# Architecture Research

**Domain:** Local-first, single-user, encrypted credential vault + OCR tool (web-first, desktop-packagable)
**Researched:** 2026-08-18
**Confidence:** HIGH — this is a well-documented, publicly-audited domain. Zero-knowledge vault design (Bitwarden/1Password), Web Crypto API constraints, and Tauri/Electron packaging patterns are all backed by official docs, published security whitepapers, and widely-reviewed OSS implementations.

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                      BROWSER / WEBVIEW (pure frontend)                │
├──────────────────────────────────────────────────────────────────────┤
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌────────────────┐     │
│  │  UI Shell │  │  Vault UI │  │  OCR UI    │  │ Unlock/Session │     │
│  │  (nav,    │  │  (list,   │  │ (upload,   │  │  UI (master pw,│     │
│  │  layout)  │  │  forms)   │  │ camera,    │  │  TOTP prompt)  │     │
│  │           │  │           │  │ preview)   │  │                │     │
│  └─────┬─────┘  └─────┬─────┘  └─────┬──────┘  └────────┬───────┘     │
│        │              │              │                   │           │
│  ┌─────┴──────────────┴──────────────┴───────────────────┴──────┐    │
│  │        CLIENT CRYPTO / SESSION LAYER (in-memory only)         │    │
│  │  • Argon2id KDF (WASM)   • AES-256-GCM encrypt/decrypt (WebCrypto) │
│  │  • Vault Key held in JS memory (never localStorage)           │    │
│  │  • Auto-lock timer, clipboard auto-clear                      │    │
│  │  • Client-side TOTP check • Client-side search over decrypted │    │
│  │    in-memory index          • Tesseract.js OCR (WASM, local)  │    │
│  └────────────────────────────┬────────────────────────────────┘    │
└───────────────────────────────┼──────────────────────────────────────┘
                    HTTP (fetch/tRPC) — ciphertext + metadata ONLY
┌───────────────────────────────┼──────────────────────────────────────┐
│                     LOCAL API / SERVER (Node — Next.js API routes)    │
├──────────────────────────────────────────────────────────────────────┤
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────────┐  │
│  │ Auth        │  │ Vault      │  │ Audit Log  │  │ (OCR: no API   │  │
│  │ Service     │  │ Repository │  │ Service    │  │  needed — pure │  │
│  │ (verifier   │  │ (blob CRUD)│  │ (append-   │  │  frontend WASM)│  │
│  │  check,     │  │            │  │  only      │  │                │  │
│  │  lockout)   │  │            │  │  writes)   │  │                │  │
│  └─────┬───────┘  └─────┬──────┘  └─────┬──────┘  └────────────────┘  │
├────────┴─────────────────┴───────────────┴────────────────────────────┤
│                     STORAGE LAYER (local SQLite file)                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │auth_credential│ │vault_entries │ │vault_folders/ │ │ audit_log    │  │
│  │(verifier hash,│ │(ciphertext,  │ │tags (encrypted│ │(entry id,    │  │
│  │ KDF salt/params│ │ IV, wrapped  │ │ or plaintext  │ │ action, ts)  │  │
│  │ wrapped VaultKey)│ vault key)  │ │ per decision  │ │              │  │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

The server/API process never receives, computes, or logs plaintext secrets — only ciphertext, IVs, and non-secret metadata cross the network/IPC boundary. All cryptographic operations happen in the browser/webview.

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|-------------------------|
| UI Shell | App-wide nav, layout, module routing, unlock gate | Next.js App Router layout, React |
| Unlock/Session UI | Master password entry, TOTP prompt, first-run setup | React form + client crypto layer calls |
| Client Crypto/Session Layer | KDF, encrypt/decrypt, in-memory key custody, auto-lock, client-side TOTP/search | Web Crypto API (AES-GCM) + Argon2id WASM lib (e.g. hash-wasm) + module-scoped/React-context key store |
| Vault UI | Entry list/forms/detail, folders, tags, search input | React components, decrypts on render from in-memory ciphertext cache |
| OCR UI | Upload/drag, camera capture, extraction preview, copy | `<input type=file>` + `getUserMedia` + Tesseract.js (WASM, Web Worker) |
| Auth Service (API) | Verify password-derived auth verifier, TOTP presence check, lockout/rate-limit state | Next.js API route / small service module |
| Vault Repository (API) | Persist/retrieve ciphertext blobs, folders/tags rows | Repository pattern over SQLite (Prisma or better-sqlite3) |
| Audit Log Service (API) | Append-only event log (unlock, create/read/update/delete, failed attempts) | API route writes to `audit_log` table on every vault-affecting request |
| Storage Layer | Durable local persistence | SQLite single file (via Prisma/better-sqlite3), no cloud dependency |

## Recommended Project Structure

```
src/
├── app/                        # Next.js App Router (routes + layouts)
│   ├── (auth)/unlock/          # unlock/first-run setup screens
│   ├── (app)/vault/            # vault module routes (list, entry detail, new)
│   ├── (app)/ocr/              # OCR module routes
│   └── api/                    # local "server" — API routes only
│       ├── auth/               # verifier check, TOTP verify, lockout state
│       ├── vault/               # ciphertext CRUD endpoints
│       └── audit/               # audit log read/write endpoints
├── modules/
│   ├── auth/                    # shared: session/auth logic, used by everything
│   │   ├── crypto.ts            # KDF, key wrapping, AES-GCM helpers (pure frontend)
│   │   ├── session.ts           # in-memory key store, auto-lock timer
│   │   └── service.ts           # server-side verifier/lockout logic
│   ├── vault/                   # vault module — owns entries, folders, tags
│   │   ├── components/
│   │   ├── repository.ts        # server-side DB access (ciphertext only)
│   │   └── service.ts           # client-side encrypt/decrypt orchestration
│   ├── ocr/                     # OCR module — fully independent of vault/auth crypto
│   │   ├── components/
│   │   └── extract.ts           # Tesseract.js wrapper, runs in Web Worker
│   └── audit/                   # cross-cutting: called by vault + auth modules
│       ├── log.ts
│       └── components/          # audit log viewer UI
├── lib/
│   ├── db.ts                    # single SQLite client/connection, shared by all modules
│   └── config.ts                # storage path, env — abstracted for later desktop packaging
└── styles/
```

### Structure Rationale

- **`modules/*`:** Each future hub module (notes, tasks, bookmarks, etc.) gets its own folder here with the same shape (components/, service.ts, repository.ts). Modules import from `modules/auth` and `modules/audit` (the shared kernel) but never reach into each other's internals — enforce with barrel exports (`index.ts` per module) now, add `eslint-plugin-boundaries` only once a 3rd/4th module makes violations likely.
- **`app/api/*`:** This is the entire "local server" surface. Because it's a clean, versioned HTTP boundary, wrapping it later in Electron (spawn Next.js server in the main process) or Tauri (bundle it as a sidecar binary) requires no logic changes — only a change in how the process is launched.
- **`lib/db.ts` + `lib/config.ts`:** Isolate filesystem/storage-path assumptions in one place so packaging for desktop (different data directory conventions per OS) is a config change, not a refactor.

## Architectural Patterns

### Pattern 1: Envelope Encryption (Key Wrapping)

**What:** Two-tier key hierarchy — a Master Key (derived from the master password via KDF, never stored) encrypts/wraps a randomly-generated Vault Key; the Vault Key (or per-item keys, optional) encrypts the actual vault data. This is the pattern Bitwarden uses.
**When to use:** Any vault where you might later want to change the master password without re-encrypting every stored item, or add recovery/multi-factor unlock paths.
**Trade-offs:** Slightly more upfront complexity than single-key encryption, but changing the master password becomes "re-wrap one small key" instead of "re-encrypt the whole vault," and it cleanly separates "what proves you are you" (auth verifier) from "what decrypts your data" (Vault Key).

**Example:**
```typescript
// On first-run setup:
const salt = crypto.getRandomValues(new Uint8Array(16));
const masterKey = await argon2id({ password: masterPassword, salt, ...kdfParams }); // WASM, client-side
const vaultKey = crypto.getRandomValues(new Uint8Array(32)); // random, generated once
const wrappedVaultKey = await aesGcmEncrypt(vaultKey, masterKey); // stored server-side, still ciphertext
const authVerifier = await argon2id({ password: masterPassword, salt: differentSalt, ... }); // sent to API, never the raw password or masterKey
```

### Pattern 2: In-Memory-Only Session Key with Auto-Lock

**What:** After unlock, the Vault Key lives only in a JS variable (module scope or React context), never in `localStorage`/`sessionStorage` (both readable by any XSS). An idle timer and explicit "lock" action clear it, forcing re-derivation from the master password.
**When to use:** Always, for any browser-based secrets manager — this is the standard mitigation for XSS exposing long-lived key material (Bitwarden, Cryptomator, and most audited web vaults follow this).
**Trade-offs:** User must re-enter master password after idle timeout or tab reload (no "remember me" persistence of the key) — this is the correct trade-off for a vault; convenience features like "remember for N minutes" should extend the in-memory timer, not persist the key to disk/storage.

**Example:**
```typescript
let vaultKey: CryptoKey | null = null; // module-scope, never serialized
let lockTimer: ReturnType<typeof setTimeout>;

function armAutoLock(minutes: number) {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => { vaultKey = null; }, minutes * 60_000);
}
```

### Pattern 3: API-Driven Local Server as the Desktop-Packaging Seam

**What:** All persistence, audit logging, and auth-verifier checks go through a local HTTP API (Next.js API routes) rather than the frontend touching the filesystem/DB directly. The frontend only ever calls `fetch('/api/...')`.
**When to use:** Any app that starts as a web app but wants a credible, low-risk path to desktop packaging later.
**Trade-offs:** A small amount of HTTP-boundary overhead (serialization, an extra process) versus a frontend that reads files directly — but it means Electron packaging is close to zero-rewrite (Electron embeds Node, so the same Next.js server runs inside the app), and Tauri packaging is "bundle the server as a sidecar binary" rather than "port persistence logic to Rust." Recommend Electron as the lower-friction desktop target for this reason, with Tauri sidecar as a viable alternative if binary size later matters more than packaging effort.

## Data Flow

### Vault Unlock Flow

```
User enters master password
    ↓
Client fetches KDF params (salt, iterations) from API — no secret involved
    ↓
Client derives Master Key locally (Argon2id, WASM, ~500ms-1s by design)
    ↓
Client derives Auth Verifier (separate KDF pass) → sends to API
    ↓
API compares verifier hash, checks lockout/rate-limit state
    ↓ (if TOTP enabled) API returns still-encrypted TOTP secret blob
Client decrypts TOTP secret with Master Key, checks user-entered code locally
    ↓
API returns wrapped Vault Key blob (ciphertext)
    ↓
Client unwraps Vault Key with Master Key → holds Vault Key in memory only
    ↓
Session established; auto-lock timer starts
```

### Vault Entry Create/Read Flow

```
Create: form data → client encrypts (AES-256-GCM, random IV) with Vault Key
    → POST ciphertext+IV+non-sensitive metadata → API writes SQLite row
    → API writes audit_log row (action=create, entry id, timestamp)

Read: client fetches ciphertext blob(s) (bulk on unlock, or per-entry on demand)
    → decrypts client-side → renders
    → API writes audit_log row (action=view) when a specific entry is opened
```

### OCR Flow (fully independent of vault crypto)

```
Image (upload/drag/camera) → Tesseract.js WASM in a Web Worker (client-side only)
    → extracted text shown in preview → user clicks copy
    → Clipboard API write, optionally auto-clear after short delay
    (no network round-trip, no server involvement, nothing persisted by default)
```

### Key Data Flows

1. **Ciphertext-only network boundary:** Everything crossing `fetch()` between frontend and the local API is either ciphertext+IV or non-secret metadata (ids, timestamps, action types) — never plaintext secrets, even though "server" and "client" are on the same machine. This is deliberate defense in depth (limits blast radius of a bug in the API/logging layer) and directly future-proofs for adding cloud sync later without a security redesign.
2. **Audit trail as a side effect, not a separate user action:** Every API call that touches vault data writes an audit_log row as part of the same request handler — the audit module is invoked by the vault module, not the other way around.
3. **OCR never touches the vault's crypto/session layer:** it's a parallel, stateless pipeline. This is the reference example for how future hub modules should relate to the vault: share the app shell and (if desired) the unlock gate, but do not depend on vault encryption internals.

## Scaling Considerations

Not a multi-user scaling story (this is single-user, local-only by design) — the relevant "scale" axis is data volume and session ergonomics over time.

| Scale | Architecture Adjustments |
|-------|---------------------------|
| Tens–hundreds of vault entries (typical v1 usage) | Bulk-fetch all ciphertext on unlock, decrypt client-side, search/filter in memory — instant, no server search needed |
| Thousands of entries | Client-side full-decrypt-on-unlock may add noticeable latency; consider lazy/paginated ciphertext fetch with decrypt-on-demand, or an encrypted local search index |
| Long-running audit log (years of use) | Add pagination and periodic archival/rotation for the `audit_log` table so it doesn't degrade list-query performance |

### Scaling Priorities

1. **First bottleneck:** Argon2id KDF cost parameters — tuned for ~0.5-1s on unlock is correct for security, but don't accidentally run it more than once per unlock (cache the derived Master Key in memory for the session).
2. **Second bottleneck:** Bulk-decrypt-on-unlock as entry count grows — move to on-demand/lazy decrypt only if profiling shows it's actually slow; don't pre-optimize for v1.

## Anti-Patterns

### Anti-Pattern 1: Encrypting/Decrypting on the API/Server Side

**What people do:** Send the master password or plaintext secret to an API route and do AES operations in Node before storing.
**Why it's wrong:** Defeats the entire zero-knowledge property — any bug, log statement, error report, or future compromise of the server process exposes plaintext. It also blocks a future "add cloud sync" milestone from being safe by default.
**Do this instead:** All KDF and AES operations happen in the browser/webview via Web Crypto API + a WASM Argon2id library; the API only ever stores/returns ciphertext.

### Anti-Pattern 2: Storing the Session Key (or Master Password) in `localStorage`/`sessionStorage`

**What people do:** Persist the derived key or password to survive page reloads, for convenience.
**Why it's wrong:** Both storages are trivially readable by any XSS in the page — turns a single script-injection bug into full vault compromise. This is the most commonly cited weakness in amateur browser-based vault implementations.
**Do this instead:** Keep the key in an in-memory JS variable only; require re-unlock after reload/idle-timeout. If "remember me" convenience is wanted, extend the in-memory timeout, not persistence.

### Anti-Pattern 3: Rolling Your Own Crypto Primitives

**What people do:** Hand-write a KDF, cipher mode, or "obfuscation" instead of using audited primitives.
**Why it's wrong:** Cryptographic implementation bugs (weak randomness, IV reuse, missing authentication) are the dominant cause of real-world vault breaks, and they're invisible until exploited.
**Do this instead:** Use Web Crypto API's native AES-GCM for symmetric encryption (browser-vetted native code) and a maintained WASM Argon2id library for KDF (Web Crypto API has no native Argon2 support — PBKDF2 is available natively but OWASP recommends Argon2id as the modern default for password-based KDF).

### Anti-Pattern 4: Blocking the Main Thread with KDF/OCR

**What people do:** Run Argon2id or Tesseract.js OCR directly on the UI thread.
**Why it's wrong:** Both are intentionally CPU-heavy (KDF for security, OCR for accuracy) and will freeze the UI for the ~0.5-2s they run, feeling broken.
**Do this instead:** Run both inside Web Workers; show a loading/progress state while they execute.

## Integration Points

### External Services

None for v1 — local-only, no cloud dependency by explicit constraint. If a future milestone adds sync, the ciphertext-only network boundary already in place means syncing encrypted blobs to a remote store requires no re-architecture of the encryption layer, only a new sync transport.

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|----------------|-------|
| Vault module ↔ Auth/Session module | Direct import of `session.ts` (in-memory Vault Key accessor) | Vault module cannot encrypt/decrypt without a live session; this dependency is intentional and foundational |
| Vault module ↔ Audit module | Vault module calls `audit.log(event)` as a side effect of API handlers | One-directional; audit module never calls back into vault |
| OCR module ↔ everything else | None (beyond shared UI shell/layout and, optionally, the app-level unlock gate) | Deliberately decoupled — reference pattern for future modules that don't need vault-level secrecy |
| Frontend ↔ Local API (`app/api/*`) | HTTP `fetch`, ciphertext + metadata only | This is the seam that becomes the Electron/Tauri packaging boundary later |

## Sources

- [Bitwarden — Inside zero-knowledge encryption](https://bitwarden.com/blog/end-to-end-encryption-and-zero-knowledge/) — HIGH confidence (vendor security documentation, cross-checked with security whitepaper)
- [Bitwarden Security Whitepaper](https://bitwarden.com/help/bitwarden-security-white-paper/) — HIGH confidence
- [Bitwarden — Cryptographic Architecture (Clients docs)](https://mintlify.wiki/bitwarden/clients/guide/cryptography) — HIGH confidence
- [Tauri — Python/Node sidecar backend pattern](https://deepwiki.com/dieharders/example-tauri-v2-python-server-sidecar/4-python-sidecar-backend) — MEDIUM confidence (community example, pattern confirmed by Tauri's own multi-process IPC architecture)
- [Tauri Secret Management issue discussion](https://github.com/tauri-apps/tauri/issues/12034) — MEDIUM confidence (maintainer/community discussion, notes real gaps in backend secret-management docs)
- [Web Crypto API client-side encryption guide](https://devtoolkit.cloud/blog/web-crypto-api-client-side-encryption) — MEDIUM confidence, cross-checked against MDN Web Crypto API reference conventions
- [Argon2 in browser — Antelle (argon2-browser)](https://antelle.net/argon2-browser/) and [hash-wasm](https://github.com/Daninet/hash-wasm) — MEDIUM-HIGH confidence (widely-used OSS WASM implementations confirming Web Crypto API's lack of native Argon2 support)
- [Bitwarden — Automatic Logout or Lock (Vault Timeout)](https://bitwarden.com/help/vault-timeout/) — HIGH confidence (vendor docs on session/auto-lock behavior)
- [Cryptomator — Vault Management docs](https://docs.cryptomator.org/ios/vault-management/) — MEDIUM confidence (confirms lock=clear-key-from-memory pattern in a different audited vault product)
- Modular monolith pattern sources (Next.js/Node) — MEDIUM confidence, general architecture guidance rather than domain-specific to vaults, used only to inform the module-boundary recommendation

---
*Architecture research for: local-first encrypted single-user credential vault + OCR tool*
*Researched: 2026-08-18*
