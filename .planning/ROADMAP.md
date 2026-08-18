# Roadmap: Personal Assistant — Vault & Lens

## Overview

This roadmap delivers a local-first, "industry grade" encrypted vault plus a Google Lens-style OCR utility, in four vertical slices. Phase 1 builds the non-negotiable foundation — master-password-derived envelope encryption, unlock, optional 2FA, and true session auto-lock — since every later phase depends on that model being correct from day one. Phase 2 builds the vault's primary user-facing value: creating, organizing, and finding every entry type (API keys, logins, notes, cards) on top of that secure foundation. Phase 3 closes the loop on the project's core value ("always safe, always retrievable") by adding leak-resistant clipboard copy, an access audit log, and encrypted backup/restore — there is no cloud sync safety net, so backup is treated as v1-critical, not a fast-follow. Phase 4 adds the OCR/Lens module, which is architecturally independent of the vault's crypto and session layer, so it is sequenced last without blocking or being blocked by vault work.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Secure Vault Setup & Unlock** - Master password, envelope encryption, optional TOTP 2FA, and true session auto-lock
- [ ] **Phase 2: Vault Core — Entries, Organization & Search** - Create/organize/find every entry type (API keys, logins, notes, cards)
- [ ] **Phase 3: Trust, Backup & Recovery** - Leak-resistant clipboard copy, access audit log, encrypted backup/restore
- [ ] **Phase 4: OCR Lens Module** - Upload/drag and live-camera text extraction with editable preview and one-tap copy

## Phase Details

### Phase 1: Secure Vault Setup & Unlock

**Goal**: Users can create a master-password-protected vault and unlock it safely, with real encryption at rest and session auto-lock guarding every entry that will ever be stored in it.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04, SEC-05
**Success Criteria** (what must be TRUE):

  1. User can set a master password and the vault initializes with real encryption (Argon2id-derived key wrapping an AES-256-GCM vault key) — no plaintext password, derived key, or secret is ever written to disk, logs, or browser storage.
  2. User can unlock the vault by entering the correct master password; an incorrect password is rejected.
  3. User can enable optional TOTP-based 2FA, and once enabled must supply both the master password and a valid TOTP code to unlock.
  4. After a period of inactivity, the vault locks automatically and the in-memory session key is destroyed — decrypted data is inaccessible until the vault is unlocked again.

**Plans**: 4/4 plans executed

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Scaffold the loopback-only full stack, the redacting logger, and the phase's type contracts

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Tracer: a user creates a vault and it is really encrypted (Argon2id + AES-256-GCM envelope, keyed SQLite)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Unlock, indistinguishable rejection, and a provably real five-minute auto-lock

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-04-PLAN.md — Optional TOTP 2FA with single-use backup codes and re-authenticated disable

### Phase 2: Vault Core — Entries, Organization & Search

**Goal**: Users can store, organize, and find every kind of sensitive data they have (API keys, logins, notes, cards) in one trusted place.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: VAULT-01, VAULT-02, VAULT-03, VAULT-04, VAULT-05, ORG-01, ORG-02, ORG-03
**Success Criteria** (what must be TRUE):

  1. User can create, view, edit, and delete API key entries (key + endpoint/model/notes).
  2. User can create, view, edit, and delete password/login entries (username + password + URL), secure note entries (freeform encrypted text), and card entries (structured sensitive data).
  3. User can generate a cryptographically strong random password when creating or editing any entry.
  4. User can organize entries into folders/categories and tag them, then filter the vault by tag.
  5. User can search across all vault entries by name or metadata and quickly find the entry they need.

**Plans**: TBD
**UI hint**: yes

### Phase 3: Trust, Backup & Recovery

**Goal**: Users can retrieve and use secrets without leaking them, see exactly when/where each secret was accessed, and never permanently lose their vault since there is no cloud sync safety net.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: TRUST-01, TRUST-02, TRUST-03, BACKUP-01, BACKUP-02
**Success Criteria** (what must be TRUE):

  1. User can copy any secret to the clipboard with one action.
  2. The clipboard is automatically cleared a short time after a vault secret is copied.
  3. User can view an audit log showing when and where each secret was accessed, with no secret values ever appearing in the log.
  4. User can export the entire vault as a single encrypted backup file.
  5. User can restore the vault from an encrypted backup file and get every entry back intact.

**Plans**: TBD
**UI hint**: yes

### Phase 4: OCR Lens Module

**Goal**: Users can extract text from an image or their live camera view and use it immediately, Google Lens-style, independent of the vault's crypto/session machinery.
**Mode:** mvp
**Depends on**: Phase 1 (shares the app shell only; architecturally independent of the vault/crypto work in Phases 2-3)
**Requirements**: OCR-01, OCR-02, OCR-03, OCR-04
**Success Criteria** (what must be TRUE):

  1. User can upload or drag an image and have text extracted from it.
  2. User can use live camera capture to extract text from whatever is in view.
  3. Extracted text appears in an editable preview before being used, so the user can catch and fix misreads.
  4. User can copy the previewed extracted text to the clipboard in one action.

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Secure Vault Setup & Unlock | 4/4 | In Progress|  |
| 2. Vault Core — Entries, Organization & Search | 0/TBD | Not started | - |
| 3. Trust, Backup & Recovery | 0/TBD | Not started | - |
| 4. OCR Lens Module | 0/TBD | Not started | - |
