/**
 * Opens the whole-file-encrypted `vault.db` and exposes it through Kysely.
 *
 * Statement order is load-bearing and must not be reordered or interleaved:
 * `new Database(path)` -> `pragma('cipher=...')` -> `.key(Buffer)` -> a
 * cheap forcing read. Reversing cipher/key order, or running any statement
 * before `.key()`, silently produces an unreadable or wrongly-encrypted
 * file (PITFALLS.md Pitfall 3). `.key()` itself never throws on a wrong
 * key — only the forcing read surfaces that failure, which is why it
 * exists here rather than being left to the first real caller query.
 */

import Database from "better-sqlite3-multiple-ciphers";
import { Kysely, SqliteDialect } from "kysely";
import { vaultAuthError } from "../../middleware/errorHandler.js";
import type { VaultDbSchema } from "./schema.js";

export function openVaultDb(
  path: string,
  vaultKey: Buffer
): Kysely<VaultDbSchema> {
  const db = new Database(path);
  db.pragma("cipher='sqlcipher'");
  db.key(vaultKey);

  try {
    // Cheap forcing read: .key() alone does not validate the key. Without
    // this, a wrong key surfaces much later as unexplained corruption.
    db.pragma("user_version");
  } catch {
    db.close();
    throw vaultAuthError();
  }

  return new Kysely<VaultDbSchema>({
    dialect: new SqliteDialect({ database: db }),
  });
}

/**
 * Creates every vault table if absent and, the first time only, inserts
 * the `schema_version` row. Plain Kysely DDL — this stack has no ORM
 * push/migrate command, so no separate schema-push step exists or should
 * be added. `onVaultOpened` (`vault-entries/bootstrap.ts`) calls this on
 * both the `/init` and `/unlock` paths, which makes it a per-open call
 * rather than a create-only call — every statement here must therefore be
 * idempotent, including the version-row insert, which only ever happens
 * once no matter how many times the vault is opened.
 */
export async function initSchema(db: Kysely<VaultDbSchema>): Promise<void> {
  await db.schema
    .createTable("schema_version")
    .ifNotExists()
    .addColumn("version", "integer", (col) => col.notNull())
    .addColumn("applied_at", "text", (col) => col.notNull())
    .execute();

  const existingVersionRow = await db
    .selectFrom("schema_version")
    .select("version")
    .executeTakeFirst();
  if (!existingVersionRow) {
    await db
      .insertInto("schema_version")
      .values({ version: 1, applied_at: new Date().toISOString() })
      .execute();
  }

  // entries: unified table for all four entry types (D-01). `payload` is
  // the type-specific JSON blob (see schema.ts doc comment); `folder_id`
  // is nullable (D-06 — exactly one optional folder per entry);
  // `deleted_at` is nullable (D-04 — soft delete).
  await db.schema
    .createTable("entries")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("type", "text", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("folder_id", "text")
    .addColumn("payload", "text", (col) => col.notNull())
    .addColumn("notes", "text")
    .addColumn("created_at", "text", (col) => col.notNull())
    .addColumn("updated_at", "text", (col) => col.notNull())
    .addColumn("deleted_at", "text")
    .execute();

  // folders: flat, fully user-defined (D-05); name is unique.
  await db.schema
    .createTable("folders")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.notNull().unique())
    .addColumn("created_at", "text", (col) => col.notNull())
    .execute();

  // tags: free-form, created on the fly (D-07); name is unique.
  await db.schema
    .createTable("tags")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.notNull().unique())
    .addColumn("created_at", "text", (col) => col.notNull())
    .execute();

  // entry_tags: many-to-many join (D-07), composite primary key.
  await db.schema
    .createTable("entry_tags")
    .ifNotExists()
    .addColumn("entry_id", "text", (col) => col.notNull())
    .addColumn("tag_id", "text", (col) => col.notNull())
    .addPrimaryKeyConstraint("entry_tags_pk", ["entry_id", "tag_id"])
    .execute();

  await db.schema
    .createIndex("entries_deleted_at_idx")
    .ifNotExists()
    .on("entries")
    .column("deleted_at")
    .execute();
  await db.schema
    .createIndex("entries_folder_id_idx")
    .ifNotExists()
    .on("entries")
    .column("folder_id")
    .execute();
  await db.schema
    .createIndex("entry_tags_tag_id_idx")
    .ifNotExists()
    .on("entry_tags")
    .column("tag_id")
    .execute();
}
