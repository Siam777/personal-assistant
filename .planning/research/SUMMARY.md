# Project Research Summary

**Project:** Personal Assistant — Local-First Encrypted Secrets Vault + OCR Tool
**Domain:** Local-first, single-user, encrypted credential vault (passwords/logins/notes/cards/API keys) with an in-browser image-to-text (OCR) module; web app first with a defined path to Tauri/Electron desktop packaging
**Researched:** 2026-08-18
**Confidence:** MEDIUM-HIGH

## Executive Summary

This is a well-trodden domain: a single-user, local-first "personal Bitwarden/KeePass hybrid" plus a Google Lens/Apple Live Text-style OCR utility. Experts build vaults like this using a two-tier envelope-encryption model (master password to Argon2id-derived Master Key to unwraps a random Vault Key to AES-256-GCM encrypts entries), keep all cryptographic operations client-side so the "server" never touches plaintext, and hold the derived key only in memory for the session (never localStorage). OCR is architecturally trivial by comparison - Tesseract.js running fully client-side in a Web Worker, decoupled from the vault's crypto/session layer entirely.

The recommended approach: Express (localhost-only, 127.0.0.1) plus React/Vite frontend, better-sqlite3-multiple-ciphers for whole-file-encrypted local SQLite storage, Argon2id for key derivation, AES-256-GCM for entry encryption, otplib for TOTP 2FA, and Tesseract.js for OCR. All of these are current, actively maintained libraries verified against npm/official docs. The stack, feature set (table-stakes: encryption at rest, master unlock, multi-type entries, folders/tags/search, auto-lock, 2FA, password generator, clipboard-copy-with-auto-clear, audit log, OCR upload+camera with preview), and architecture (ciphertext-only network boundary, in-memory-only session key, modular monolith with vault/auth/audit/OCR as independent modules) all point toward the same phase ordering: get crypto and the unlock/session model right first, since everything else - vault CRUD, audit logging, backup - depends on that foundation being correct.

The primary risk is security-implementation risk, not product-scope risk: rolling custom crypto, persisting keys in XSS-reachable storage, or implementing "lock" as a UI-only state (key still resident in memory) are the top pitfalls, and they are each foundational-phase concerns that are expensive to retrofit later. A secondary, lower-stakes risk is OCR memory blow-up from un-downscaled camera images feeding an unbounded Tesseract.js worker pool - cheap to prevent up front, expensive-feeling (though low-severity) to patch later. Confidence in the overall research is medium-high: architecture and pitfalls are backed by primary vendor security docs (Bitwarden, Cryptomator) and OWASP; the stack's core recommendations are npm/registry-verified, though a few specific claims (e.g., the better-sqlite3-multiple-ciphers drop-in alias) are flagged as needing validation against the library's own README before being relied on.

## Key Findings

### Recommended Stack

Node.js 24.x LTS + TypeScript 6.0.3 (not 7.x yet - tooling gap) + React 19.2 + Vite 8 on the frontend, with a localhost-only Express 5 API mediating all vault/DB access so the browser never touches the encrypted SQLite file or crypto keys directly. better-sqlite3-multiple-ciphers gives whole-database-file encryption (closest analog to KeePass's single encrypted file, closing the "plaintext folder/tag/audit-log metadata" leak that field-level-only encryption would leave open). Argon2id (node-argon2, raw mode) derives keys from the master password; Kysely (not a full ORM) sits directly on the SQLite driver so PRAGMA key timing is explicit and controllable. Tesseract.js runs OCR fully client-side/WASM with zero network calls. otplib + qrcode cover TOTP 2FA enrollment/verification.

**Core technologies:**
- Node.js 24.x LTS - runtime; needed for native module compatibility and the eventual Electron/Tauri path
- Express 5 (bound to 127.0.0.1 only) - mediates all vault/OCR-adjacent operations; never let the frontend touch the DB/keys directly
- better-sqlite3-multiple-ciphers - whole-file encrypted local SQLite vault store (AES-256/ChaCha20 at the page level)
- argon2 (node-argon2, raw mode) - master-password key derivation (Argon2id, memory-hard, current best practice over PBKDF2)
- React + Vite - frontend SPA; framework-agnostic build output that both Express and a later Tauri frontendDist can serve unmodified
- Tesseract.js (WASM, Web Worker) - fully local OCR engine, no cloud dependency
- otplib + qrcode - TOTP 2FA generation/verification and enrollment QR codes
- Kysely - type-safe query builder chosen over Prisma specifically for the vault table, to keep PRAGMA key timing explicit

### Expected Features

Feature research directly mirrors Bitwarden/1Password/KeePass table stakes plus the Google Lens/Apple Live Text OCR interaction pattern (detect, preview/editable, one-tap copy). Notably, several "differentiators" here (audit log by default, clipboard auto-clear by default) are things mainstream competitors gate behind paid tiers or leave off by default - genuine, low-cost trust wins for a personal tool.

**Must have (table stakes / v1):**
- Encryption at rest (Argon2id KDF + AES-256-GCM), master password unlock, optional TOTP 2FA
- Multiple entry types: logins, secure notes, cards, API keys - each with its own metadata schema
- Folders + tags + cross-entry search, password generator
- Auto-lock/session timeout, clipboard copy with auto-clear
- Audit log of secret access (metadata only - never the secret value)
- OCR: upload/drag image to editable preview to one-action copy; OCR: live camera capture to preview to copy

**Should have (competitive/differentiators, v1.x):**
- Local reuse/weak-password detection (no network call needed)
- Encrypted local backup/restore - the local-first substitute for cloud sync, treat as near-table-stakes given no sync exists as a safety net
- Password strength meter at entry time
- OCR history/recent scans (only if encrypted and short-retention by default)

**Defer (v2+):**
- Cloud sync/multi-device, browser extension/autofill, multi-user/shared vaults, live breach-database checking via network call (privacy-preserving k-anonymity HIBP-style if ever added), plugin/scripting architecture

### Architecture Approach

A modular monolith: a pure-frontend client crypto/session layer (Argon2id WASM + Web Crypto AES-GCM, in-memory-only Vault Key) talks to a thin local Express API over fetch, where the API only ever receives/returns ciphertext + IVs + non-secret metadata - never plaintext. This "ciphertext-only network boundary" is deliberate defense-in-depth even though client and server are on the same machine, and it's also what makes future cloud sync or Tauri/Electron desktop packaging low-risk (the API boundary becomes the packaging seam; no crypto redesign needed).

**Major components:**
1. Client Crypto/Session Layer - KDF, AES-GCM encrypt/decrypt, in-memory Vault Key custody, auto-lock timer, clipboard auto-clear (frontend, WASM/Web Crypto)
2. Vault module (UI + repository + service) - entry CRUD, folders/tags, search; repository is server-side ciphertext-only persistence, encrypt/decrypt orchestration is client-side
3. Auth/Session module - verifier check, TOTP verification, lockout/rate-limit state (server-side verifier logic + client-side session key store)
4. Audit module - append-only, metadata-only event log, invoked as a side effect by the vault module (never the reverse)
5. OCR module - fully independent of vault crypto/session; Tesseract.js in a Web Worker, shares only the app shell/optional unlock gate - the reference pattern for how future hub modules (notes, tasks, bookmarks) should attach without depending on vault internals

### Critical Pitfalls

1. **Rolling your own crypto primitives** - use only crypto.subtle/Node crypto for AES-256-GCM and a real Argon2id library for KDF; never a hand-rolled cipher, weak KDF, or Math.random() for salts/IVs. Foundational phase, highest leverage to get right.
2. **Persisting the derived key (or master password) in XSS-reachable storage** - never localStorage/sessionStorage; keep the Vault Key in an in-memory (ideally non-extractable CryptoKey) variable only, re-derive on each unlock, pair with strict CSP and no dangerouslySetInnerHTML on vault/OCR-rendered text.
3. **"Locked" UI that doesn't actually destroy the key** - auto-lock must zero out and drop references to the in-memory key, not just swap a route/flag; verify via UAT that decrypted data is unreachable after lock without re-entering the master password.
4. **Sensitive data leaking into logs/audit log/errors** - audit log schema must be metadata-only (entry id, action, timestamp) by design, never a value/secret column; strip sensitive fields in global error handlers; no console.log of vault entry objects.
5. **OCR/camera treated as "just a UI feature"** - downscale every image (~1200px long edge) before OCR, use a bounded Tesseract.js worker pool (not one worker per call), and explicitly stop() every MediaStreamTrack after capture - otherwise unbounded WASM heap growth and a stuck camera indicator are the real-world failure modes, not edge cases.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Crypto & Storage Foundation
**Rationale:** Every other feature (vault CRUD, audit log, auto-lock, backup) depends on the key-derivation, encryption, and storage model being correct from the start; retrofitting crypto after data exists means a painful re-encryption migration (see Pitfalls "Recovery Strategies").
**Delivers:** Envelope-encryption scheme (Argon2id Master Key to wrapped random Vault Key to AES-256-GCM entry encryption), encrypted SQLite storage (better-sqlite3-multiple-ciphers), local Express API bound to 127.0.0.1 with a ciphertext-only boundary, first-run vault setup flow.
**Addresses:** Encryption at rest (table stakes, FEATURES.md), storage layer (ARCHITECTURE.md Storage Layer + Pattern 1: Envelope Encryption)
**Avoids:** Pitfall 1 (rolling your own crypto), Pitfall 5 (exposed local server), Security Mistake "no per-vault salt"

### Phase 2: Unlock, Session & Auto-Lock
**Rationale:** The master-password unlock flow and in-memory session-key lifecycle is the second-highest-leverage security surface and must be correct before any UI renders decrypted data; TOTP 2FA layers directly on top of this.
**Delivers:** Master password unlock flow, optional TOTP 2FA (otplib + qrcode), in-memory-only Vault Key with non-extractable CryptoKey where possible, idle/tab-blur auto-lock (2-5 min default) that actually zeroes key material.
**Addresses:** Master password unlock + 2FA + auto-lock (table stakes, FEATURES.md)
**Avoids:** Pitfall 2 (XSS-reachable key storage), Pitfall 3 (lock that doesn't destroy the key), Security Mistake "TOTP as replacement not layer"

### Phase 3: Vault Core (Entry CRUD, Folders, Tags, Search)
**Rationale:** With crypto and session established, the core vault UX can be built directly on top of stable primitives; this is the largest single feature surface and delivers the primary user-facing value.
**Delivers:** Entry types (login/note/card/API key) with per-type metadata schemas, folders (single-parent) + tags (many-to-many), client-side search over the in-memory decrypted index, password generator.
**Uses:** Kysely over better-sqlite3-multiple-ciphers (STACK.md), Vault module pattern (ARCHITECTURE.md Component Responsibilities)
**Implements:** Vault Repository + Vault UI + Vault service (client-side encrypt/decrypt orchestration)

### Phase 4: Clipboard, Audit Log & Trust Features
**Rationale:** These are cheap once encryption-at-rest and vault CRUD exist, and they directly serve the stated Core Value ("secrets never leak silently") - sequencing them right after vault core keeps that value proposition intact before OCR (a separate module) is introduced.
**Delivers:** Copy-to-clipboard with auto-clear (10-20s) + UI messaging about OS clipboard-history risk, append-only metadata-only audit log wired as a side effect of every vault-affecting API call.
**Addresses:** Clipboard copy + audit log (table stakes / near-table-stakes differentiator, FEATURES.md)
**Avoids:** Pitfall 4 (clipboard leakage), Pitfall 7 (sensitive data in logs/audit log)

### Phase 5: OCR Module (Upload + Camera)
**Rationale:** Architecturally independent of the vault/crypto/session layer (per ARCHITECTURE.md, OCR "never touches the vault's crypto/session layer"), so it can be built without dependency risk on Phases 1-4; also lets the worker-pool/downscaling pattern be designed once, not retrofitted.
**Delivers:** Upload/drag image to editable preview to one-action clipboard copy; live camera capture sharing the same OCR pipeline; bounded Tesseract.js worker pool; client-side image downscaling before OCR.
**Addresses:** OCR upload/preview/copy + OCR live camera capture (table stakes, FEATURES.md)
**Avoids:** Pitfall 8 (OCR/camera memory & privacy pitfalls - unbounded worker memory, stuck camera indicator)

### Phase 6 (v1.x, post-launch validation): Backup/Restore & Local Reuse Detection
**Rationale:** Explicitly sequenced after v1 core per FEATURES.md's MVP definition - these are "add after validation" items, not launch blockers, but should land early in v1.x since there's no cloud-sync safety net.
**Delivers:** Encrypted local backup/restore (re-uses the same KDF/cipher scheme, never a plaintext export by default), local password reuse/weak-password detection.
**Avoids:** Pitfall 6 (plaintext backup/export files left on disk)

### Phase Ordering Rationale

- Crypto/storage before session before vault CRUD before audit/clipboard before OCR: this directly follows the Feature Dependencies graph in FEATURES.md (encryption at rest requires master password unlock requires auto-lock; audit log requires encryption at rest + copy-to-clipboard) and the "foundational phase" callouts repeated across PITFALLS.md for Pitfalls 1-3.
- OCR is deliberately sequenced as its own late phase specifically because ARCHITECTURE.md establishes it as architecturally decoupled from the vault - building it later doesn't block or get blocked by vault work, and treating it as the "reference pattern for future hub modules" argues for building it once vault module boundaries are already proven out.
- Backup/restore and reuse detection are explicitly v1.x in FEATURES.md's own MVP Definition, not v1 - the roadmap should treat them as a fast-follow phase rather than launch-blocking.
- Desktop packaging (Electron/Tauri) is intentionally not in this phase list - STACK.md and ARCHITECTURE.md both frame it as a decision to make after v1 validates, not a v1 phase; the Express-API-as-packaging-seam pattern means it can be added later with minimal rearchitecture.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (Crypto & Storage Foundation):** Validate the better-sqlite3-multiple-ciphers "drop-in alias for better-sqlite3" claim and exact PRAGMA key timing against the library's own README before committing (flagged LOW-MEDIUM confidence in STACK.md); also confirm Node 24 prebuilt native-binary availability for this package and argon2 before locking the Node version.
- **Phase 5 (OCR Module):** Tesseract.js worker-pool sizing and image-downscale thresholds should be validated against real (multi-MP) camera photos, not just test images - the memory-blowup failure mode (PITFALLS.md Pitfall 8) doesn't show up with small test images.

Phases with standard patterns (skip research-phase):
- **Phase 2 (Unlock, Session & Auto-Lock):** Envelope encryption + in-memory session key + auto-lock is a well-documented pattern (Bitwarden's own published cryptographic architecture, cross-checked with Cryptomator) - HIGH confidence, standard implementation.
- **Phase 3 (Vault Core):** Entry CRUD/folders/tags/search directly mirrors Bitwarden/1Password/KeePass's established UX and data model - MEDIUM-HIGH confidence, no novel design needed.
- **Phase 4 (Clipboard/Audit):** Both patterns (auto-clear clipboard, metadata-only audit log) are explicitly documented via vendor docs and security blog sources.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Core libraries verified via Context7/official docs and live npm registry versions (HIGH for versions); several ecosystem claims (e.g., better-sqlite3-multiple-ciphers alias/maintenance, Prisma vs Kysely pragma-timing) verified only via web search, not primary source - flagged explicitly in STACK.md for validation during Phase 1. |
| Features | MEDIUM | Cross-checked across official vendor docs (Bitwarden, 1Password, Apple, KeePass reviews) and multiple independent reviews; no primary academic security papers consulted, but competitor feature parity is well-established via first-party docs. |
| Architecture | HIGH | Backed by Bitwarden's own published security whitepaper and cryptographic architecture docs, cross-checked with Cryptomator's vault-lock model; this is a publicly-audited, well-documented domain. |
| Pitfalls | MEDIUM | Cross-referenced OWASP, MDN, Tauri official docs, Bitwarden docs, and GitHub issue trackers (Tesseract.js memory issues are primary-sourced from the project's own issue tracker); no single primary spec covers "solo dev builds their own vault" end-to-end, so synthesis across sources is the researcher's own. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- better-sqlite3-multiple-ciphers drop-in-alias and PRAGMA key timing claims: validate directly against the library's README/source during Phase 1 implementation before relying on it as a hard dependency decision.
- Native module compatibility (better-sqlite3-multiple-ciphers, argon2) with Node 24.x prebuilt binaries: confirm before locking the Node version, otherwise Phase 1 setup risks compiling from source.
- TypeScript 7.x tooling gap: revisit staying on TS 6.0.3 once typescript-eslint ships stable support for TS 7.1's API - not a v1 blocker, but worth a periodic check during later phases.
- Desktop packaging path (Electron vs. Tauri) is deliberately left undecided by design (STACK.md, ARCHITECTURE.md) - no gap to resolve now, but the roadmap should treat this as an explicit future milestone decision point, not embed a premature choice into v1 phases.
- Full-text search over encrypted vault content is only viable via in-memory decrypt-on-unlock at v1 scale (tens-hundreds of entries); if entry counts grow into the thousands, ARCHITECTURE.md's Scaling Considerations flag this as needing a lazy/paginated decrypt approach - not a v1 concern but worth flagging for future milestones.

## Sources

### Primary (HIGH confidence)
- Bitwarden Security Whitepaper and "Inside zero-knowledge encryption" - envelope encryption, cryptographic architecture
- Bitwarden Cryptographic Architecture (Clients docs) - key wrapping, in-memory session model
- Bitwarden "Automatic Logout or Lock (Vault Timeout)" - auto-lock behavior baseline
- npm registry (registry.npmjs.org) - live version verification for all recommended packages, checked 2026-08-18
- nodejs.org dist index - current Node.js LTS line
- tesseract.js GitHub Issues #900, #446 - primary-sourced memory-usage failure mode

### Secondary (MEDIUM confidence)
- Context7 /tauri-apps/tauri-docs, /ranisalt/node-argon2, /yeojz/otplib, /naptha/tesseract.js, /prisma/web - library API/version verification
- OWASP Password Storage Cheat Sheet, OWASP HTML5 Security Cheat Sheet - KDF and XSS guidance
- MDN AesGcmParams, MDN MediaDevices.getUserMedia - Web Crypto and camera API references
- Cryptomator Vault Management docs - cross-validation of lock=clear-key pattern
- 1Password Watchtower / Features, KeePass reviews (SafetyDetectives, AllAboutCookies) - competitor feature analysis
- Tauri v2 Localhost plugin docs, Application Lifecycle Threats - desktop-packaging security guidance

### Tertiary (LOW confidence)
- Web search: better-sqlite3-multiple-ciphers maintenance status and drop-in-alias claim - unverified against primary README, flagged for Phase 1 validation
- Web search: React vs Svelte in Tauri ecosystem, Tesseract.js vs PaddleOCR/cloud OCR tradeoffs - aggregated blog/guide sources
- Web search: Node crypto AES-256-GCM envelope encryption pattern - aggregated guide sources, though consistent with established cryptographic practice

---
*Research completed: 2026-08-18*
*Ready for roadmap: yes*
