/**
 * Free-form, create-on-the-fly tagging (D-07 in 02-CONTEXT.md): typing a
 * new tag name while tagging an entry creates it automatically, and typing
 * the same name again reuses the existing row rather than duplicating it —
 * the `tags.name` unique constraint is the backstop, `setEntryTags`'s
 * look-up-then-insert is the fast path. Same module shape as
 * `vaultMeta.ts`: small, single-purpose functions over `getDb()`.
 */

import { randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import { getDb } from "../auth/session.js";
import type { VaultDbSchema } from "../db/schema.js";

export interface Tag {
  id: string;
  name: string;
  entryCount: number;
}

interface TagRow {
  id: string;
  name: string;
  entry_count: number | bigint | null;
}

function rowToTag(row: TagRow): Tag {
  return { id: row.id, name: row.name, entryCount: Number(row.entry_count ?? 0) };
}

/** Every tag with its count of live (non-deleted) entries, ordered by count descending then name ascending. */
export async function listTags(): Promise<Tag[]> {
  const db = getDb();
  const rows = await db
    .selectFrom("tags")
    .leftJoin("entry_tags", "entry_tags.tag_id", "tags.id")
    .leftJoin("entries", (join) =>
      join
        .onRef("entries.id", "=", "entry_tags.entry_id")
        .on("entries.deleted_at", "is", null)
    )
    .select(["tags.id", "tags.name"])
    .select((eb) => eb.fn.count<number>("entries.id").as("entry_count"))
    .groupBy(["tags.id", "tags.name"])
    .orderBy("entry_count", "desc")
    .orderBy("tags.name", "asc")
    .execute();

  return rows.map(rowToTag);
}

/**
 * Replaces `entryId`'s tag links with exactly the resolved set of `names`,
 * inside one transaction. Names are trimmed; empty and duplicate names
 * within the submitted list are dropped before resolution. An existing tag
 * row is reused by name rather than duplicated — this is the mechanism
 * that keeps the `tags` table free of duplicate names under D-07's
 * create-on-the-fly rule. A tag row is never deleted here even when this
 * call removes its last link, so it stays available for reuse on another
 * entry.
 */
export async function setEntryTags(entryId: string, names: string[]): Promise<void> {
  const db = getDb();
  const normalized = Array.from(new Set(names.map((name) => name.trim()).filter((name) => name.length > 0)));

  await db.transaction().execute(async (trx) => {
    const tagIds: string[] = [];
    for (const name of normalized) {
      const existing = await trx.selectFrom("tags").select("id").where("name", "=", name).executeTakeFirst();
      if (existing) {
        tagIds.push(existing.id);
      } else {
        const created = await trx
          .insertInto("tags")
          .values({ id: randomUUID(), name, created_at: new Date().toISOString() })
          .returning("id")
          .executeTakeFirstOrThrow();
        tagIds.push(created.id);
      }
    }

    await trx.deleteFrom("entry_tags").where("entry_id", "=", entryId).execute();
    if (tagIds.length > 0) {
      await trx
        .insertInto("entry_tags")
        .values(tagIds.map((tagId) => ({ entry_id: entryId, tag_id: tagId })))
        .execute();
    }
  });
}

/**
 * One query mapping each of the given entry ids to its tag names, so
 * listing N entries costs one extra query rather than N. Accepts either
 * the live `getDb()` handle or an open transaction, so callers already
 * inside a transaction (none yet, but future callers may be) are not
 * forced to open a second one.
 */
export async function tagsForEntries(
  entryIds: string[],
  db: Kysely<VaultDbSchema> | Transaction<VaultDbSchema> = getDb()
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (entryIds.length === 0) return result;

  const rows = await db
    .selectFrom("entry_tags")
    .innerJoin("tags", "tags.id", "entry_tags.tag_id")
    .select(["entry_tags.entry_id", "tags.name"])
    .where("entry_tags.entry_id", "in", entryIds)
    .execute();

  for (const row of rows) {
    const existing = result.get(row.entry_id);
    if (existing) {
      existing.push(row.name);
    } else {
      result.set(row.entry_id, [row.name]);
    }
  }

  return result;
}
