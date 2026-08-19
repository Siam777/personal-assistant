# Phase 2: Vault Core — Entries, Organization & Search - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-19
**Phase:** 2-Vault Core — Entries, Organization & Search
**Areas discussed:** Entry data model, Folders & tags structure

---

## Entry data model

| Option | Description | Selected |
|--------|-------------|----------|
| Unified table + JSON payload | One `entries` table plus a `payload` column holding type-specific fields as encrypted JSON. | ✓ |
| Separate table per type | api_keys, logins, notes, cards each with their own typed columns. | |
| Hybrid: shared core + typed child tables | Core `entries` table + a child table per type for structured secret fields. | |

**User's choice:** Unified table + JSON payload
**Notes:** Chosen because whole-DB encryption already covers it and it simplifies cross-type search/tag/folder joins for ORG-03.

| Option | Description | Selected |
|--------|-------------|----------|
| Flexible JSON blob per type | Each type has a JSON schema validated in app code (Zod), stored as one encrypted JSON column. | ✓ |
| Typed columns per type | Explicit nullable columns for every possible field, DB-enforced. | |

**User's choice:** Flexible JSON blob per type

| Option | Description | Selected |
|--------|-------------|----------|
| Soft delete with trash/undo | Deleted entries move to a trash state, recoverable for a period. | ✓ |
| Hard delete immediately | Delete is permanent right away, matching Phase 1's no-recovery philosophy. | |
| Hard delete with confirmation dialog | No trash state, but requires explicit confirmation. | |

**User's choice:** Soft delete with trash/undo
**Notes:** Deliberately differs from Phase 1's master-password hard-no-recovery stance — that was about a cryptographic secret; entries are ordinary app data where a safety net makes sense.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — optional notes field on every entry | In addition to type-specific fields, every entry gets one freeform encrypted notes field. | ✓ |
| No — fixed schema per type only | Only the fields defined in REQUIREMENTS exist. | |
| Yes — fully custom key/value fields per entry | Users can add arbitrary named fields to any entry. | |

**User's choice:** Yes — optional notes field on every entry

---

## Folders & tags structure

| Option | Description | Selected |
|--------|-------------|----------|
| Flat folders, one per entry | A single flat list of folders; each entry belongs to exactly one folder (or none). | ✓ |
| Nested/hierarchical folders | Folders can contain subfolders. | |
| No folders, tags only | Drop folders entirely, rely purely on tags. | |

**User's choice:** Flat folders, one per entry

| Option | Description | Selected |
|--------|-------------|----------|
| Exactly one folder | Each entry has a single folder_id (nullable = uncategorized). | ✓ |
| Multiple folders per entry | Entries can be filed under several folders at once. | |

**User's choice:** Exactly one folder

| Option | Description | Selected |
|--------|-------------|----------|
| Free-form, created on the fly | User types a tag name; if it doesn't exist, it's created automatically. | ✓ |
| Predefined tag list, managed separately | Tags must be created first in a management screen. | |

**User's choice:** Free-form, created on the fly

| Option | Description | Selected |
|--------|-------------|----------|
| Fully user-defined | Folders are user-created containers, independent of entry type. | ✓ |
| Auto-generated per entry type | Four built-in folders, one per entry type, non-editable. | |

**User's choice:** Fully user-defined

---

## Claude's Discretion

- Soft-delete trash retention window and purge mechanism (automatic vs. manual).
- Search mechanism (SQLite FTS5 vs. `LIKE` queries) — never touches decrypted secret values, only name/folder/tags/metadata.
- Secret-reveal UX in entry detail view (masked-by-default toggle vs. always-visible vs. auto-rehide timer).
- Password generator placement and customization depth.
- Exact JSON schema shape per entry type's fields.

## Deferred Ideas

- **"App design should look modern"** pending todo — reviewed, routed to `/gsd-ui-phase 2` rather than folded into this discussion. Client currently has zero styling from Phase 1's crypto-first scoping.
