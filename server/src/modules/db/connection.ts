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
 * Creates the `schema_version` table if absent and inserts the current
 * version row. Plain Kysely DDL executed once at vault creation — this
 * stack has no ORM push/migrate command, so no separate schema-push step
 * exists or should be added.
 */
export async function initSchema(db: Kysely<VaultDbSchema>): Promise<void> {
  await db.schema
    .createTable("schema_version")
    .ifNotExists()
    .addColumn("version", "integer", (col) => col.notNull())
    .addColumn("applied_at", "text", (col) => col.notNull())
    .execute();

  await db
    .insertInto("schema_version")
    .values({ version: 1, applied_at: new Date().toISOString() })
    .execute();
}
