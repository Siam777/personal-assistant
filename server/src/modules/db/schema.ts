/**
 * Kysely schema for the encrypted vault database. This is a plain
 * TypeScript interface for Kysely's generic parameter, not an ORM
 * schema-push file — every table here is created by a Kysely DDL call in
 * `db/connection.ts`'s `initSchema`.
 *
 * `entries.payload` holds a JSON string of the type-specific fields for
 * that entry (D-01/D-02 in 02-CONTEXT.md — a single unified table rather
 * than one table per entry type). It is protected by the whole-database-
 * file cipher established in Phase 1 (`openVaultDb`'s `cipher='sqlcipher'`
 * + `.key()`) — there is deliberately no second encryption layer applied
 * to this column, and no cleartext sibling column ever holds the same
 * data unencrypted.
 */
export interface VaultDbSchema {
  schema_version: { version: number; applied_at: string };
  entries: {
    id: string;
    type: "api_key" | "login" | "note" | "card";
    name: string;
    folder_id: string | null;
    payload: string;
    notes: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  };
  folders: {
    id: string;
    name: string;
    created_at: string;
  };
  tags: {
    id: string;
    name: string;
    created_at: string;
  };
  entry_tags: {
    entry_id: string;
    tag_id: string;
  };
}
