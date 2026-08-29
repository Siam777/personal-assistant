# Phase 3: Trust, Backup & Recovery - Context

**Gathered:** 2026-08-29
**Status:** Ready for planning
**Mode:** Autonomous / YOLO execution

<domain>
## Phase Boundary

Delivers leak-resistant clipboard copy with auto-clear, comprehensive access audit logging, and authenticated encrypted backup export & restore. Closes the core value loop ("Secrets stored in the vault are always safe and always retrievable when needed").

Requirements:
- `TRUST-01`: User can copy any secret to the clipboard with one action
- `TRUST-02`: Clipboard is automatically cleared a short time after a vault secret is copied
- `TRUST-03`: User can view an audit log of when/where each secret was accessed, without secret values appearing in the log
- `BACKUP-01`: User can export the entire vault as a single encrypted backup file
- `BACKUP-02`: User can restore the vault from an encrypted backup file and get every entry back intact

</domain>

<decisions>
## Implementation Decisions

### 1. Audit Logging Architecture
- Add `audit_logs` table in `server/src/modules/db/schema.ts` and `initSchema`.
- Table columns: `id` (UUID), `event_type` (text), `entry_id` (nullable text), `entry_name` (nullable text), `entry_type` (nullable text), `details` (nullable text), `ip_address` (nullable text), `user_agent` (nullable text), `created_at` (text ISO).
- Invariant: Strictly NO plaintext secret values (passwords, keys, cvv, notes, master passwords, TOTP secrets) are ever written to `audit_logs`.
- Recorded events: `vault_unlocked`, `vault_locked`, `entry_created`, `entry_viewed`, `entry_updated`, `entry_deleted`, `secret_revealed`, `secret_copied`, `vault_exported`, `vault_restored`, `two_factor_enabled`, `two_factor_disabled`.
- Endpoint: `GET /api/vault/audit` supporting pagination (`limit`, `offset`) and event-type / entry filtering.

### 2. Clipboard Copy & Auto-Clear
- 1-action copy button attached to secret fields in `EntryDetail` and entry rows.
- On copy, writes secret to `navigator.clipboard.writeText` and arms a 30-second client-side timeout that clears clipboard.
- Visual toast notification with countdown / clear feedback.
- Fires audit event `secret_copied` (reporting entry id, name, type, and field name e.g. "password", but never secret text).

### 3. Encrypted Backup & Restore
- Single portable JSON backup file (`.vaultbackup` / `.json`).
- Encrypted with AES-256-GCM under a key derived from password using Argon2id with fresh salt + IV + auth tag.
- Backup payload contains: `schema_version`, `exported_at`, `entries`, `folders`, `tags`, `entry_tags`, `audit_logs`.
- Restore process:
  1. Decrypts and authenticates backup file using provided password. Tag mismatch fails fast without touching database.
  2. Validates schema and structure with Zod schema.
  3. Inside a single atomic database transaction (`db.transaction()`), safely imports all data.
  4. Records `vault_restored` audit log event.
- Export endpoint: `POST /api/vault/backup/export` (downloads encrypted file).
- Restore endpoint: `POST /api/vault/backup/restore` (accepts encrypted file + password).

</decisions>

<code_context>
## Existing Code Insights

- Express backend on loopback with `requireUnlocked` session middleware.
- Kysely + `better-sqlite3-multiple-ciphers` with whole-file encrypted SQLite database.
- Zod validation on all endpoints.
- React + Tailwind + Radix UI / shadcn-style components in client.

</code_context>
