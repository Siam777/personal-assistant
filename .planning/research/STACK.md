# Stack Research

**Domain:** Local-first encrypted secrets vault + in-browser OCR (image-to-text) tool, web-first with a path to Tauri/Electron desktop packaging
**Researched:** 2026-08-18
**Confidence:** MEDIUM (core libraries verified via Context7/official docs and current npm registry versions; ecosystem/pattern claims verified via multiple web sources but not cross-checked against a primary spec in every case — see per-row confidence notes)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 24.x LTS ("Krypton") | Runtime for local backend | Current LTS as of Aug 2026; required for `node:sqlite` availability (still experimental — see below) and for the eventual Tauri sidecar / Electron main-process option. **Confidence: MEDIUM** |
| TypeScript | 6.0.3 (not 7.x yet) | Type safety across frontend + backend | TypeScript 7.0 (the new Go-native compiler) shipped stable July 2026 with ~10x faster builds, but ships **without a stable programmatic API until 7.1**, so `typescript-eslint` and several framework tooling plugins don't support it yet. For a security-critical app where type-aware linting matters, stay on the 6.x line until 7.1 lands and the toolchain catches up; revisit then. **Confidence: HIGH** (verified via official TypeScript blog + registry) |
| React | 19.2.x | Frontend UI framework | Not the fastest option (Svelte compiles to less runtime code), but it's the most-used framework in the Tauri ecosystem, has the deepest component/library ecosystem, and is the safest choice for a solo builder who will extend this into a multi-module "personal assistant platform" later and wants abundant prior art. Tauri is explicitly frontend-agnostic, so this choice doesn't block the desktop path. **Confidence: MEDIUM** |
| Vite | 8.x | Frontend build tool / dev server | Standard pairing with React SPAs; produces a static `dist/` that both a Node/Express server and a later Tauri `frontendDist` can serve directly — no framework lock-in (unlike Next.js, which entangles server-rendering concerns you don't need for a single-user local app). **Confidence: MEDIUM** |
| Express | 5.2.x | Local backend HTTP API (localhost-only) | The frontend (browser) must never touch the vault DB or crypto keys directly — a small local API server mediates all vault/OCR-adjacent operations. Express is the simplest, most portable choice: it runs unmodified as an Electron main-process module, and can be packaged as a Tauri "sidecar" binary later without a rewrite. Bind strictly to `127.0.0.1`, never `0.0.0.0`. **Confidence: MEDIUM** |
| better-sqlite3-multiple-ciphers | 13.0.3 | Encrypted local SQLite database (the vault file) | A maintained, API-compatible fork of `better-sqlite3` (same synchronous API, drop-in via package alias) that adds SQLite3MultipleCiphers support — full-database encryption (AES-256 or ChaCha20) at the page level, not just column-level. This means the vault file, including entry metadata, folder/tag names, and the audit log table, is encrypted at rest as a single file — closest analog to the KeePass/KeePassXC model. Actively maintained (releases within days), real dependents, Electron-prebuild compatible. **Confidence: LOW-MEDIUM** (web-verified, not primary-source verified; validate the "drop-in alias for better-sqlite3" claim against the project's own README before committing) |
| argon2 (node-argon2) | 0.45.x | Key derivation from the master password | Argon2id is the current best-practice choice for deriving a symmetric key from a user password (memory-hard, side-channel resistant, winner of the Password Hashing Competition). Use it in **raw mode** (`raw: true`) to derive the raw key bytes that become the SQLCipher/multiple-ciphers database key — do not use its PHC-string password-hash mode for this purpose, that's for password *verification*, not key derivation. **Confidence: MEDIUM** (Context7-verified against official docs) |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| otplib | 13.4.x | TOTP 2FA generation/verification | Use the v13 functional API (`generateSecret`, `generate`, `verify`, `generateURI`) — not the deprecated `v12-adapter` shim shown in some older docs/examples. Default params (SHA1, 6 digits, 30s period) are required for Google Authenticator/Authy compatibility; use `epochTolerance` on verify to absorb clock drift. |
| qrcode | 1.5.x | Render the otpauth:// URI as a QR code for 2FA enrollment | Pair directly with `otplib`'s `generateURI`; convert to a data URL for the enrollment screen. |
| Tesseract.js | 7.0.x | OCR (image-to-text), runs fully client-side | Core OCR engine. WASM port of Tesseract, runs in the browser (or Node) with zero network calls — critical for a "local-only, no cloud dependency" constraint. Create the worker once (`createWorker('eng')`) and reuse it across recognitions; don't spin up a new worker per image. |
| Kysely | ^0.28.x | Type-safe SQL query builder over `better-sqlite3-multiple-ciphers` | Recommended **instead of a full ORM** for the vault schema specifically. The cipher key must be applied via `PRAGMA key` immediately after opening the connection, before any other statement runs — this timing is easy to get wrong through an ORM's abstracted connection lifecycle. Kysely sits directly on the raw `better-sqlite3`-compatible driver, so you control connection open + pragma-key timing explicitly. Keep this scoped to the vault DB only. |
| zod | 4.x | Runtime schema validation | Validate every request into the local API (vault entry shape, TOTP setup payload, etc.) and validate data coming back out of the DB layer before it reaches the frontend. Cheap insurance against malformed data ever being treated as trusted. |
| @tanstack/react-query | 5.x | Data fetching/caching between frontend and local API | Handles loading/error states, cache invalidation and refetch for vault list/search/folder/tag views without hand-rolled state machines. |
| zustand | 5.x | Small global client state (vault unlock/lock status, session countdown) | Lighter than Redux/Context-for-everything; a good fit for the handful of cross-cutting UI states (locked/unlocked, idle-timeout countdown, active folder/tag filter) this app needs. |
| Tailwind CSS | 4.x | Styling | Fast to build a polished, consistent UI solo; v4's CSS-first config is simpler to wire into Vite than v3's JS config. |
| Node `crypto` (built-in) | Node 24.x | AES-256-GCM envelope encryption primitives, random IV/salt generation | No third-party AES library needed — Node's `crypto` is backed by OpenSSL/AES-NI and outperforms pure-JS implementations. Use for encrypting individual sensitive blobs if you choose defense-in-depth beyond whole-DB cipher encryption (see Stack Patterns below). |
| Web Clipboard API (`navigator.clipboard`) | Browser built-in | Copy extracted OCR text in one action | No library required; requires a secure context (fine on `localhost`/Tauri webview). |
| Web MediaDevices API (`getUserMedia`) | Browser built-in | Live camera capture for OCR | No library required; capture a still frame to `<canvas>`, then feed the canvas/blob to the Tesseract.js worker. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Vitest | Unit/integration tests | Pairs natively with Vite; use for crypto/key-derivation logic and API route logic — these are the highest-stakes code paths in this app and deserve real test coverage. |
| Playwright | End-to-end tests | Cover the unlock flow, vault CRUD, and the OCR upload → preview → copy flow at least once end-to-end; camera capture can be tested with a fake video device. |
| ESLint + typescript-eslint 8.67.x | Linting, type-aware lint rules | Stay on TypeScript 6.x specifically because this is the version typescript-eslint currently supports (see Core Technologies note on TS7). |
| dotenv | Local environment/config values (non-secret config only — e.g. port number) | Never put the master password, derived keys, or vault contents in `.env` — this is for app config only. |

## Installation

```bash
# Core
npm install express better-sqlite3-multiple-ciphers argon2 otplib qrcode tesseract.js kysely zod

# Frontend
npm install react react-dom @tanstack/react-query zustand
npm install -D vite @vitejs/plugin-react tailwindcss @tailwindcss/vite

# Dev dependencies
npm install -D typescript@6 typescript-eslint eslint vitest @playwright/test dotenv
```

Note: alias `better-sqlite3-multiple-ciphers` as `better-sqlite3` in `package.json` if any tooling (e.g. Kysely's SQLite dialect helpers) expects the package name literally:
```json
"better-sqlite3": "npm:better-sqlite3-multiple-ciphers@^13.0.3"
```
Verify this alias against the fork's own README before relying on it in production — this was verified via web search, not the primary source.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| React + Vite (SPA) | SvelteKit | If solo-dev preference leans toward smaller bundle size / less runtime overhead over ecosystem breadth — Svelte compiles away the framework at build time and pairs very well with Tauri, but has a smaller component-library ecosystem to draw on for a fast-moving solo project. |
| Express (Node backend) | Tauri Rust commands (skip Node backend entirely) | If you're willing to commit to Tauri now rather than later, doing crypto/DB access as native Rust `#[tauri::command]`s from day one is more secure (no localhost HTTP surface at all) and avoids the later "package a Node process as a Tauri sidecar" step. Only worth it if you're confident you won't ship a browser-only version first — the project's stated constraint ("web app first") argues against this for v1. |
| better-sqlite3-multiple-ciphers (whole-DB encryption) | Plain `better-sqlite3` + manual AES-256-GCM per field (application-level envelope encryption) | If you want the audit log and folder/tag structure to remain queryable in plaintext (e.g. for full-text search indexing) while only secret *values* are encrypted. This adds real complexity (key management per field, searchable fields must stay outside the encrypted blob) — only take this path if whole-DB encryption turns out to block a feature you need (e.g. SQLite FTS5 full-text search over encrypted content, which doesn't work directly against encrypted blobs). |
| Kysely (query builder) | Prisma ORM | Prisma has excellent SQLite support (`@prisma/adapter-better-sqlite3`) and would be reasonable for *non-vault* data (e.g. future hub-module data). Avoid it for the vault table specifically: Prisma's driver-adapter connection lifecycle doesn't have a documented, verified hook for applying `PRAGMA key` before Prisma's own connection-warmup queries run against `better-sqlite3-multiple-ciphers`. If you validate that timing works cleanly, Prisma becomes a fine choice project-wide — but the vault is exactly the wrong place to discover it doesn't. |
| Tesseract.js (local WASM OCR) | Cloud OCR API (Google Cloud Vision, Azure AI Document Intelligence) | If OCR accuracy on messy/low-quality images becomes a real UX problem — cloud OCR is materially more accurate on noisy scans, tables, and handwriting — but this breaks the "local-only, no cloud dependency" constraint. Keep as an opt-in power-user setting at most, never the default. |
| Tesseract.js | PaddleOCR | If you outgrow Tesseract's accuracy ceiling on complex documents and are willing to invest in a non-trivial local ML runtime (PaddleOCR has no mature browser/npm story comparable to Tesseract.js — it would mean running a Python/ONNX model server locally, adding real architectural weight for a "smart clipboard"-style feature). Not recommended for v1. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| PBKDF2 for master-password key derivation | Weaker against GPU/ASIC brute-force than memory-hard functions; still common in older tutorials but no longer best practice for a new project in 2026 | Argon2id (node-argon2), as above |
| `plain better-sqlite3` with no encryption + "encrypt in app code only, DB file stays plaintext otherwise" | Leaves folder names, tags, audit-log entries (which service/URL was accessed when) as plaintext metadata on disk even if secret *values* are encrypted — a real information leak for a "no plaintext ever" bar | `better-sqlite3-multiple-ciphers` for whole-file encryption, or explicit field-level encryption applied consistently to every column, not just "the sensitive-looking ones" |
| AES-256-CBC (or any non-authenticated mode) for secret encryption | No built-in integrity/tamper protection — a corrupted or tampered ciphertext decrypts to garbage silently instead of failing loudly | AES-256-GCM (authenticated), and never drop the auth tag |
| Reusing an IV/nonce across encryptions with the same key | Well-documented catastrophic failure mode for GCM — can leak the authentication key entirely | Generate a fresh random 12-byte IV per encryption operation, always |
| Electron as the "just build it in Electron directly, skip the web app" shortcut | Contradicts the explicit "web app first" constraint and locks in a much larger runtime footprint (bundles a full Chromium + Node) earlier than needed | Web app now (Express + Vite/React), decide Electron vs. Tauri for packaging once v1 is validated |
| TypeScript 7.0.x today | Ships without a stable public API until 7.1; `typescript-eslint` and several framework plugins (Vue/Svelte/Astro/Angular tooling) don't support it yet — real risk of tooling breakage for marginal build-speed gain on a project this size | TypeScript 6.0.3 for now; revisit TS7 once 7.1 ships and `typescript-eslint` adds support |
| Storing the derived master key (or the master password) anywhere persistent (disk, localStorage, cookies with long TTL) | Defeats the entire "encrypted at rest" premise the moment the key sits next to the ciphertext it protects | Hold the derived key only in server-process memory for the duration of an unlocked session; re-derive on each unlock; zero it out on lock/idle-timeout |

## Stack Patterns by Variant

**If you commit to Tauri packaging sooner rather than later:**
- Move vault CRUD + crypto out of Express and into Rust `#[tauri::command]`s, calling `rusqlite` + a Rust Argon2/AES crate instead of the Node equivalents.
- Because: this removes the localhost HTTP surface entirely (no port to bind, no CORS/auth surface between frontend and "backend") and is the security-maximal end state referenced by "industry grade" in the project's stated bar — but it's a rewrite of the security-critical layer, not a wrapper, so it's reasonable to defer past v1.

**If Electron is the eventual desktop target instead of Tauri:**
- Keep the Express backend as-is; it becomes (or is spawned by) the Electron main process directly — no sidecar packaging step needed, since Electron's main process already is Node.
- Because: this is the lowest-effort desktop path given the recommended stack, at the cost of a materially larger installer (bundled Chromium) than Tauri would produce.

**If full-text search over vault entries becomes a hard requirement:**
- Whole-database page-level encryption (as recommended) makes SQLite FTS5 unusable directly against encrypted content in the general case.
- Because of that: either decrypt-then-search in application memory for the (expected-small) personal vault size, or move to field-level encryption with an unencrypted searchable-metadata table — re-evaluate against the "Prisma vs Kysely" alternative row above if you go this route, since it changes the DB architecture non-trivially.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| typescript@6.0.3 | typescript-eslint@8.67.x | Confirmed current pairing; do not upgrade TypeScript to 7.x until typescript-eslint publishes support (tracked for TS 7.1's stable API). |
| better-sqlite3-multiple-ciphers@13.0.3 | better-sqlite3@13.0.3 (API surface) | Fork tracks the same major version number as upstream `better-sqlite3`, which is a good signal of intentional API parity — verify against the fork's own compatibility notes before aliasing it project-wide. |
| Node.js 24.x LTS | better-sqlite3-multiple-ciphers, argon2 (native bindings) | Both ship native modules; confirm prebuilt binaries exist for Node 24 + your target OS/arch before locking the Node version, otherwise you're compiling from source on install. |
| Vite 8.x | React 19.2.x, @vitejs/plugin-react | Standard current pairing, no known issues. |

## Sources

- Context7 `/tauri-apps/tauri-docs` — Tauri v2 frontend-independence, packaging model (confidence: MEDIUM)
- Context7 `/ranisalt/node-argon2` — Argon2id parameters, raw-mode key derivation (confidence: MEDIUM)
- Context7 `/yeojz/otplib` — TOTP generate/verify/URI API, v13 functional API (confidence: MEDIUM)
- Context7 `/naptha/tesseract.js` — worker lifecycle, scheduler, performance notes (confidence: MEDIUM)
- Context7 `/prisma/web` — SQLite driver-adapter model, informed the decision to avoid Prisma for the vault DB specifically (confidence: MEDIUM)
- npm registry (registry.npmjs.org) — live version lookups for all listed packages, checked 2026-08-18 (confidence: HIGH, primary source)
- nodejs.org dist index — current Node.js LTS line (confidence: HIGH, primary source)
- Web search: better-sqlite3 vs node:sqlite vs sql.js comparisons (confidence: LOW, aggregated blog/guide sources)
- Web search: better-sqlite3-multiple-ciphers maintenance status and Prisma/Knex/TypeORM compatibility claims (confidence: LOW, unverified against primary README)
- Web search: Node crypto AES-256-GCM envelope encryption pattern (confidence: LOW, aggregated guide sources, but consistent with well-established cryptographic practice)
- Web search: Tesseract.js vs PaddleOCR / cloud OCR accuracy tradeoffs (confidence: LOW)
- Web search: React vs Svelte in the Tauri ecosystem (confidence: LOW)
- Web search: Bitwarden vs KeePass architecture comparison, informed the "whole-DB encrypted file" vs "zero-knowledge per-record" pattern choice (confidence: LOW)
- Web search: TypeScript 7.0 native compiler release status via devblogs.microsoft.com/typescript and InfoQ (confidence: MEDIUM — official vendor blog cross-checked with independent reporting)

---
*Stack research for: local-first encrypted secrets vault + OCR tool, web-first with desktop packaging path*
*Researched: 2026-08-18*
