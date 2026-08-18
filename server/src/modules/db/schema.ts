/**
 * Kysely schema for the encrypted vault database. This phase only defines
 * `schema_version`; Phase 2 extends this interface with entry tables. This
 * is a plain TypeScript interface for Kysely's generic parameter, not an
 * ORM schema-push file — the table itself is created by a Kysely DDL call
 * in Plan 01-02.
 */
export interface VaultDbSchema {
  schema_version: { version: number; applied_at: string };
}
