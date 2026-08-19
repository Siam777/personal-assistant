/**
 * Folder CRUD (D-05 in 02-CONTEXT.md — folders are flat and fully
 * user-defined: there is deliberately no hierarchy field on this table and
 * no argument on any function here accepts one) with uncategorize-on-
 * delete semantics (D-06 — an entry's folder is a single nullable
 * reference, so deleting a folder must never delete the entries inside
 * it). Same module shape as `vaultMeta.ts`: small, single-purpose
 * functions operating on the unlocked session's Kysely handle.
 */

import { randomUUID } from "node:crypto";
import { getDb } from "../auth/session.js";

export interface Folder {
  id: string;
  name: string;
  createdAt: string;
  entryCount: number;
}

/**
 * Thrown when a folder name collides with the `folders.name` unique
 * constraint. `routes.ts` catches this and converts it to a 409 rather
 * than letting it fall through to the generic 500.
 */
export class DuplicateFolderNameError extends Error {
  constructor() {
    super("A folder with that name already exists");
    this.name = "DuplicateFolderNameError";
  }
}

interface FolderRow {
  id: string;
  name: string;
  created_at: string;
  entry_count: number | bigint | null;
}

function rowToFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    entryCount: Number(row.entry_count ?? 0),
  };
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" || /unique constraint/i.test(err.message);
}

/** Every folder ordered by name ascending, each carrying its count of live (non-deleted) entries. */
export async function listFolders(): Promise<Folder[]> {
  const db = getDb();
  const rows = await db
    .selectFrom("folders")
    .leftJoin("entries", (join) =>
      join.onRef("entries.folder_id", "=", "folders.id").on("entries.deleted_at", "is", null)
    )
    .select(["folders.id", "folders.name", "folders.created_at"])
    .select((eb) => eb.fn.count<number>("entries.id").as("entry_count"))
    .groupBy(["folders.id", "folders.name", "folders.created_at"])
    .orderBy("folders.name", "asc")
    .execute();

  return rows.map(rowToFolder);
}

/**
 * Trims the given name and rejects an empty result. Inserts with a fresh
 * `crypto.randomUUID()`. There is no id argument for a containing folder
 * anywhere in this signature — that absence is what "flat" means here.
 */
export async function createFolder(name: string): Promise<Folder> {
  const db = getDb();
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Folder name is required");
  }

  const now = new Date().toISOString();
  try {
    const row = await db
      .insertInto("folders")
      .values({ id: randomUUID(), name: trimmed, created_at: now })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { id: row.id, name: row.name, createdAt: row.created_at, entryCount: 0 };
  } catch (err) {
    if (isUniqueConstraintError(err)) throw new DuplicateFolderNameError();
    throw err;
  }
}

/** Returns null when `id` matches no folder. Surfaces a duplicate name the same way `createFolder` does. */
export async function renameFolder(id: string, name: string): Promise<Folder | null> {
  const db = getDb();
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Folder name is required");
  }

  try {
    const row = await db
      .updateTable("folders")
      .set({ name: trimmed })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    if (!row) return null;

    const countRow = await db
      .selectFrom("entries")
      .select((eb) => eb.fn.count<number>("id").as("entry_count"))
      .where("folder_id", "=", id)
      .where("deleted_at", "is", null)
      .executeTakeFirst();

    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      entryCount: Number(countRow?.entry_count ?? 0),
    };
  } catch (err) {
    if (isUniqueConstraintError(err)) throw new DuplicateFolderNameError();
    throw err;
  }
}

/**
 * Inside a single transaction: first sets `folder_id` to null on every
 * entry that referenced this folder, then deletes the folder row. Entries
 * that were inside the deleted folder become uncategorized — this
 * function never issues a delete against the `entries` table, matching
 * the exact guarantee the UI-SPEC delete-folder confirmation copy makes
 * to the user. Returns whether a folder row was actually removed, so the
 * route can answer 404 for an absent id.
 */
export async function deleteFolder(id: string): Promise<boolean> {
  const db = getDb();
  return db.transaction().execute(async (trx) => {
    await trx.updateTable("entries").set({ folder_id: null }).where("folder_id", "=", id).execute();

    const result = await trx.deleteFrom("folders").where("id", "=", id).executeTakeFirst();
    return (result.numDeletedRows ?? 0n) > 0n;
  });
}
