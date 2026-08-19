# Phase 2: Vault Core — Entries, Organization & Search - Context

**Gathered:** 2026-08-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can create, view, edit, and delete every kind of sensitive data entry (API keys, logins, secure notes, cards), organize them into folders and tags, generate strong passwords, and search across all entries by name/metadata. This phase delivers: the vault entry schema and CRUD for all four entry types (VAULT-01–04), password generation (VAULT-05), folder organization (ORG-01), tagging and tag filtering (ORG-02), and cross-entry search (ORG-03) — all built on top of Phase 1's already-encrypted whole-DB-file storage (`better-sqlite3-multiple-ciphers` + Kysely). It does NOT deliver clipboard copy/auto-clear, access audit log, backup/restore (Phase 3), or OCR (Phase 4). Visual/UI design system work is also out of this discussion's scope — deferred to `/gsd-ui-phase 2` (see Deferred below).

</domain>

<decisions>
## Implementation Decisions

### Entry Data Model
- **D-01:** A single unified `entries` table (id, type, name, folder_id, created_at, updated_at, deleted_at) holds all four entry types, with type-specific fields stored as an encrypted JSON `payload` column rather than separate per-type tables. Because Phase 1 already encrypts the whole DB file, no additional field-level crypto is needed on top of the JSON payload. — **Reversibility:** costly — rationale: splitting into per-type tables later requires a data migration across every existing entry, plus rewriting all search/tag/folder queries that currently join against one table.
- **D-02:** Type-specific structured fields (card number/expiry/CVV, login username/password/URL, API key/endpoint/model/notes) are validated in application code (Zod) against a per-type schema, then stored as JSON — not as explicit typed DB columns. Adding a new field to a type later is a code change, not a schema migration.
- **D-03:** Every entry, regardless of type, also gets one optional freeform `notes` field in addition to its type-specific fields, for anything that doesn't fit the predefined schema.
- **D-04:** Entry deletion is a **soft delete**: deleted entries get a `deleted_at` timestamp and move to a trash/recoverable state (exact retention window — e.g. 30 days — left to Claude's discretion during planning) rather than being purged immediately. This differs deliberately from Phase 1's master-password "hard no-recovery" stance — that was about a cryptographic secret with no possible recovery mechanism; individual vault entries are ordinary app data where losing one to a misclick has no such constraint, so a safety net is appropriate.

### Folders & Tags Structure
- **D-05:** Folders are **flat** (no nesting/hierarchy) and **fully user-defined** — not auto-generated per entry type. A user can mix entry types freely within one folder (e.g. an API key and a login both in "Work").
- **D-06:** Each entry belongs to **exactly one folder** (nullable — unfoliated/uncategorized entries are allowed). Folders are a single-select `folder_id` on the entry, not a many-to-many join.
- **D-07:** Tags are **free-form and created on the fly** — typing a new tag name when tagging an entry creates it automatically, no separate tag-management screen, no predefined list, no max-tags-per-entry limit. Tags are many-to-many (an entry can have multiple tags; a tag can apply to multiple entries), satisfying ORG-02's "tag entries and filter by tag."

### Claude's Discretion
- Exact soft-delete trash retention window (e.g. 30 days) before permanent purge, and whether purge is automatic or manual-only.
- Search mechanism (SQLite FTS5 vs. simple `LIKE` queries) — not discussed in this session; must only ever index/query entry `name`, `folder`, `tags`, and non-secret metadata, never decrypted secret payload values (this boundary is non-negotiable regardless of mechanism chosen).
- Secret-reveal UX in the entry detail view (masked-by-default with toggle vs. always-visible vs. auto-rehide timer) — not discussed in this session; apply reasonable judgment, consistent with the vault's "always safe" core value.
- Password generator placement and customization depth (inline on password/login fields vs. standalone tool; length/symbol/number toggles vs. sensible fixed default) — not discussed in this session.
- Exact JSON schema shape per entry type (field names/types within api_keys, logins, notes, cards) — implement per REQUIREMENTS.md's parenthetical field lists (e.g. "key + endpoint/model/notes" for API keys).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Stack & Schema (carried forward from Phase 1 — still governs this phase)
- `.planning/research/STACK.md` — Node 24.x + Express local API (127.0.0.1 only), `better-sqlite3-multiple-ciphers` (whole-DB-file encryption already covers entry data — no extra field crypto needed), Kysely as the query builder/schema layer.
- `server/src/modules/db/schema.ts` — Current Kysely `VaultDbSchema` interface has only `schema_version`; this phase adds the `entries`, `folders`, and `tags`/`entry_tags` tables per D-01/D-05/D-07 above.
- `.planning/research/PITFALLS.md` — Still-relevant guidance: no plaintext secret ever logged or written outside the encrypted DB; this now extends to the entry `payload` JSON (must go through the same encrypted-at-rest path as everything else, never a separate unencrypted convenience field).

### Project-Level Constraints
- `.planning/PROJECT.md` — "Industry grade" security bar applies to entry data exactly as it did to vault unlock; no plaintext secret ever stored/logged.
- `.planning/REQUIREMENTS.md` — VAULT-01 through VAULT-05, ORG-01 through ORG-03 (this phase's requirements); TRUST-01/02 (clipboard) explicitly deferred to Phase 3, not built here even though entry detail views are.
- `.planning/ROADMAP.md` §Phase 2 — Success criteria this phase must satisfy; also flags `UI hint: yes`.
- `.planning/phases/01-secure-vault-setup-unlock/01-CONTEXT.md` — Phase 1's decisions (D-01 through D-06 there): server-mediated crypto, `requireUnlocked` session gating, in-memory session key model that all entry CRUD routes must respect (no entry read/write without an active unlocked session).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/src/middleware/requireUnlocked.ts` — Existing middleware that gates routes on an active unlocked session; all new entry CRUD routes must use this.
- `server/src/modules/db/connection.ts` — Existing Kysely/better-sqlite3-multiple-ciphers connection setup; new entry tables extend the same connection, no new DB setup needed.
- `server/src/middleware/validate.ts` — Existing request validation middleware (likely Zod-based) — reuse for entry payload validation per D-02.
- `client/src/lib/api.ts` — Existing API client wrapper from Phase 1; extend rather than duplicate for new entry endpoints.

### Established Patterns
- `server/src/modules/auth/` — Phase 1's module structure (routes.ts, session.ts, plus a `.test.ts` per concern) is the pattern to follow for a new `server/src/modules/vault/` (or `entries/`) module in Phase 2.
- `client/src/features/vault-unlock/`, `client/src/features/vault-2fa/` — Feature-folder convention (`client/src/features/<feature-name>/`) established in Phase 1; Phase 2 entry/folder/tag/search UI should follow the same convention (e.g. `client/src/features/vault-entries/`).

### Integration Points
- All entry routes sit behind `requireUnlocked` and use the session-scoped Kysely DB connection already established in Phase 1 — no new session/auth work needed, only new tables and routes within the existing security boundary.

</code_context>

<specifics>
## Specific Ideas

No specific UI/visual references given in this session — visual direction explicitly deferred to `/gsd-ui-phase 2` (see Deferred below). Functional/data-model specifics are captured in Decisions above (unified entries table + JSON payload, flat user-defined folders, free-form tags, soft-delete trash).

</specifics>

<deferred>
## Deferred Ideas

None beyond the reviewed todo below — discussion stayed within phase scope.

### Reviewed Todos (not folded)
- **"App design should look modern"** (`.planning/todos/pending/2026-08-18-app-design-should-look-modern.md`) — Reviewed, not folded into this CONTEXT.md. The client currently has zero styling (no CSS, no component library) from Phase 1's crypto-first scoping. User confirmed this should be routed to `/gsd-ui-phase 2` (which ROADMAP.md already flags with `UI hint: yes`) to establish the design system before Phase 2 planning, rather than captured as an ad hoc decision here.

</deferred>

---

*Phase: 2-Vault Core — Entries, Organization & Search*
*Context gathered: 2026-08-19*
