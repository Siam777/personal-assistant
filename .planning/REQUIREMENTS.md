# Requirements: Personal Assistant — Vault & Lens

**Defined:** 2026-08-18
**Core Value:** Secrets stored in the vault are always safe (real encryption, never plaintext) and always retrievable when needed — this must never fail or leak.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Security & Unlock

- [ ] **SEC-01**: User can set a master password that derives the vault's encryption key (Argon2id KDF + AES-256-GCM envelope encryption)
- [ ] **SEC-02**: User can unlock the vault by entering the correct master password
- [ ] **SEC-03**: User can enable optional TOTP-based 2FA on top of the master password
- [ ] **SEC-04**: Vault automatically locks after a period of inactivity, destroying the in-memory session key (not just hiding the UI)
- [ ] **SEC-05**: No plaintext secret, derived key, or master password is ever written to disk, logs, or localStorage/sessionStorage

### Vault Entries

- [ ] **VAULT-01**: User can create, view, edit, and delete API key entries (key + endpoint/model/notes)
- [ ] **VAULT-02**: User can create, view, edit, and delete password/login entries (username + password + URL)
- [ ] **VAULT-03**: User can create, view, edit, and delete secure note entries (freeform encrypted text)
- [ ] **VAULT-04**: User can create, view, edit, and delete card entries (structured sensitive data)
- [ ] **VAULT-05**: User can generate a cryptographically strong random password when creating an entry

### Organization & Search

- [ ] **ORG-01**: User can organize entries into folders/categories
- [ ] **ORG-02**: User can tag entries and filter by tag
- [ ] **ORG-03**: User can search across all vault entries by name/metadata

### Trust & Access

- [ ] **TRUST-01**: User can copy a secret to the clipboard with one action
- [ ] **TRUST-02**: Clipboard is automatically cleared a short time after a vault secret is copied
- [ ] **TRUST-03**: User can view an audit log of when/where each secret was accessed, without secret values appearing in the log

### Backup

- [ ] **BACKUP-01**: User can export the entire vault as a single encrypted backup file
- [ ] **BACKUP-02**: User can restore the vault from an encrypted backup file

### OCR (Image-to-Text)

- [ ] **OCR-01**: User can upload or drag an image to extract text from it
- [ ] **OCR-02**: User can use live camera capture to extract text from what's in view
- [ ] **OCR-03**: Extracted text is shown in an editable preview before being used (Lens-style, catches misreads)
- [ ] **OCR-04**: User can copy the previewed extracted text to clipboard in one action

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Vault Hardening (near-term fast-follow)

- **HARDEN-01**: Local password reuse/weak-password detection (compares hashes within the vault, no network call)
- **HARDEN-02**: Password strength meter shown live when creating/editing an entry

### OCR Enhancements

- **OCR-HIST-01**: Short-retention, encrypted history of recent OCR scans

### Platform Expansion

- **PLAT-01**: Desktop packaging (Electron/Tauri) of the web app
- **PLAT-02**: Cloud sync / multi-device sync
- **PLAT-03**: Live breach-database checking (privacy-preserving, e.g. k-anonymity HIBP-style query)
- **PLAT-04**: Browser extension / autofill
- **PLAT-05**: Additional personal-hub modules (notes, tasks, bookmarks, etc.)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Cloud sync / multi-device sync | Local-only storage is an explicit v1 constraint; sync adds a server, account system, and much larger attack surface before the local vault design is even validated |
| Browser extension / autofill | Explicit v1 constraint; deep browser integration (content scripts, permissions) is disproportionate scope for a standalone app |
| Multi-user / shared vaults / emergency access | Single-user personal tool; sharing requires permission models and key-sharing cryptography with zero payoff for a solo tool |
| Live breach-database checking via network call | Requires an outbound network dependency, which conflicts with the local-only/no-cloud-dependency constraint; local reuse detection covers the low-hanging-fruit case without it |
| Server-side/cloud OCR | Would send potentially sensitive image content (screenshots of API keys, recovery codes) to a third party, directly undermining the local-first, no-plaintext-leak posture |
| Plugin architecture / scripting | Massive scope for a solo v1 build; future extensibility is handled as new platform modules, not a third-party plugin API |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | TBD | Pending |
| SEC-02 | TBD | Pending |
| SEC-03 | TBD | Pending |
| SEC-04 | TBD | Pending |
| SEC-05 | TBD | Pending |
| VAULT-01 | TBD | Pending |
| VAULT-02 | TBD | Pending |
| VAULT-03 | TBD | Pending |
| VAULT-04 | TBD | Pending |
| VAULT-05 | TBD | Pending |
| ORG-01 | TBD | Pending |
| ORG-02 | TBD | Pending |
| ORG-03 | TBD | Pending |
| TRUST-01 | TBD | Pending |
| TRUST-02 | TBD | Pending |
| TRUST-03 | TBD | Pending |
| BACKUP-01 | TBD | Pending |
| BACKUP-02 | TBD | Pending |
| OCR-01 | TBD | Pending |
| OCR-02 | TBD | Pending |
| OCR-03 | TBD | Pending |
| OCR-04 | TBD | Pending |

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 0 (pending roadmap creation)
- Unmapped: 22 ⚠️ (expected — roadmap not yet created)

---
*Requirements defined: 2026-08-18*
*Last updated: 2026-08-18 after initial definition*
