# Personal Assistant — Vault & Lens

## What This Is

A personal hub application, starting with two modules: a secure credential vault for API keys, passwords, secure notes, and sensitive data; and an image-to-text (OCR) tool for ad-hoc text extraction from images, used like a smarter clipboard (Google Lens-style). Built as a web app first, architected so it can be packaged as a desktop app later. This is the foundation of a broader personal assistant platform — future milestones will add more modules.

## Core Value

Secrets stored in the vault are always safe (real encryption, never plaintext) and always retrievable when needed — this must never fail or leak.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] User can store and retrieve API keys (with metadata like endpoint/model/notes)
- [ ] User can store and retrieve passwords/logins (username + password + URL)
- [ ] User can store secure freeform notes (recovery codes, SSH keys, config snippets)
- [ ] User can store cards/other structured sensitive data
- [ ] User can organize vault entries with folders/categories
- [ ] User can organize vault entries with tags, and filter by tag
- [ ] User can search across all vault entries
- [ ] Vault unlocks with a master password
- [ ] User can optionally enable 2FA (TOTP) on top of the master password
- [ ] All secrets are encrypted at rest — no plaintext ever stored or logged
- [ ] User can view an audit log of when/where a secret was accessed
- [ ] User can upload or drag an image to extract text from it (OCR)
- [ ] User can use a live camera capture to extract text from what's in view
- [ ] Extracted text is shown in a preview before being copied/used (Lens-style)
- [ ] User can copy extracted text to clipboard in one action

### Out of Scope

- Cloud sync / multi-device sync — deferred to a future milestone; local-only for v1 keeps complexity and attack surface down while the vault design proves itself
- Other hub modules (notes, tasks, bookmarks, etc.) — deferred; v1 stays focused on vault + OCR so it ships well
- Browser extension / autofill — not needed for v1; standalone app first
- Multi-user support — this is a single-user personal tool

## Context

- First milestone of a broader personal assistant platform the user is building toward — vault and OCR are the initial modules, not the whole vision.
- User is accumulating API keys across services (OpenRouter, Azure, others) faster than ad hoc notes/plaintext can handle, and wants one trusted place before it becomes unmanageable.
- Greenfield project — no existing codebase.
- "Industry grade" was explicitly requested and means, in priority: real security (proper encryption, no plaintext), polished/reliable UX, an extensible architecture for future modules, and audit/observability of secret access.

## Constraints

- **Storage**: Local-only for v1, no cloud dependency — sync was explicitly deferred by the user to keep v1 simple and secure
- **Security**: No plaintext secrets at rest under any circumstances — "industry grade" security was the user's explicit bar
- **Platform**: Must be architected so it can be packaged as a desktop app later (e.g. a stack compatible with Tauri/Electron) — user wants that option without committing to it now
- **Scope**: Single user, no multi-tenant concerns

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Web app first, architected for later desktop conversion | User wants desktop as an option without building it now | — Pending |
| Local-only storage for v1 | Reduces complexity and attack surface; sync deferred | — Pending |
| Master password + optional 2FA for vault unlock | Matches user's explicit security bar | — Pending |
| v1 scope limited to vault + OCR only | Keeps first milestone focused and shippable | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-18 after initialization*
