/**
 * Entry service layer: a module of small, single-purpose functions
 * operating on the unlocked session's Kysely handle (`getDb()` from
 * `../auth/session.js`), following the `vaultMeta.ts` shape. Every
 * function here throws "Vault is locked" if called without an unlocked
 * session — `getDb()` throws rather than returning null, so no query can
 * ever run on a dead handle.
 */

import { randomUUID } from "node:crypto";
import { getDb } from "../auth/session.js";
import { applyEntryFilters, type EntryListFilter } from "./search.js";
import { setEntryTags, tagsForEntries } from "./tags.js";
import type { EntryCreateInput, EntryPayload, EntryType, EntryUpdateInput } from "./schemas.js";

/**
 * Thrown by `updateEntry` when the request declares a `type` different from
 * the stored row's `type` — entry type is immutable after creation because
 * a type change would silently orphan the stored payload shape (a `login`
 * payload interpreted as a `card` payload, for instance). `routes.ts`
 * catches this specific error and converts it to a 400 with a specific
 * message, distinct from the generic 500 every other thrown error falls
 * through to.
 */
export class EntryTypeImmutableError extends Error {
  constructor() {
    super("Entry type cannot be changed");
    this.name = "EntryTypeImmutableError";
  }
}

export interface EntrySummary {
  id: string;
  type: EntryType;
  name: string;
  folderId: string | null;
  folderName: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Entry {
  id: string;
  type: EntryType;
  name: string;
  folderId: string | null;
  tags: string[];
  payload: EntryPayload;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface EntrySummaryRow {
  id: string;
  type: EntryType;
  name: string;
  folder_id: string | null;
  folder_name: string | null;
  created_at: string;
  updated_at: string;
}

interface EntryRow {
  id: string;
  type: EntryType;
  name: string;
  folder_id: string | null;
  payload: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Never reads payload/notes columns — this is the mechanism enforcing the
 * "list responses never carry a decrypted secret value" prohibition. */
export function rowToSummary(row: EntrySummaryRow, tags: string[]): EntrySummary {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    folderId: row.folder_id,
    folderName: row.folder_name,
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToEntry(row: EntryRow, tags: string[]): Entry {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    folderId: row.folder_id,
    tags,
    payload: JSON.parse(row.payload) as EntryPayload,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/**
 * Inserts a new entry row, then persists its tags via `setEntryTags` —
 * closing the gap where the `tags` field has been part of the request
 * contract since 02-01 without being persisted. Never dedupes or upserts:
 * two calls with identical field values produce two rows with distinct ids
 * (VAULT-01 idempotency requirement in 02-01-PLAN.md's must_haves).
 */
export async function createEntry(input: EntryCreateInput): Promise<Entry> {
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();

  const row = await db
    .insertInto("entries")
    .values({
      id,
      type: input.type,
      name: input.name,
      folder_id: input.folderId ?? null,
      payload: JSON.stringify(input.payload),
      notes: input.notes ?? null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await setEntryTags(id, input.tags ?? []);
  const tagsByEntry = await tagsForEntries([id]);

  return rowToEntry(row as EntryRow, tagsByEntry.get(id) ?? []);
}

/**
 * Non-deleted entries only (or exclusively deleted ones when
 * `filter.deleted` is true), filtered through `applyEntryFilters` for
 * folder/tag/search composition, ordered by most-recently-updated first
 * then by id so two entries sharing an `updated_at` value still have a
 * deterministic, stable order across repeated identical requests. Selects
 * only summary columns plus the joined folder name — payload and notes
 * are never read here.
 */
export async function listEntries(filter: EntryListFilter = {}): Promise<EntrySummary[]> {
  const db = getDb();
  const rows = await db
    .selectFrom("entries")
    .leftJoin("folders", "folders.id", "entries.folder_id")
    .$call((qb) => applyEntryFilters(qb, filter))
    .select([
      "entries.id",
      "entries.type",
      "entries.name",
      "entries.folder_id",
      "folders.name as folder_name",
      "entries.created_at",
      "entries.updated_at",
    ])
    .orderBy("entries.updated_at", "desc")
    .orderBy("entries.id", "asc")
    .execute();

  const tagsByEntry = await tagsForEntries(rows.map((row) => row.id));
  return rows.map((row) => rowToSummary(row as EntrySummaryRow, tagsByEntry.get(row.id) ?? []));
}

/**
 * The only function in this module that reads the `payload` column. Returns
 * null for an absent id or a soft-deleted entry — trashed entries are not
 * served through the normal read path (T-02-12).
 */
export async function getEntry(id: string): Promise<Entry | null> {
  const db = getDb();
  const row = await db
    .selectFrom("entries")
    .selectAll()
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .executeTakeFirst();

  if (!row) return null;
  const tagsByEntry = await tagsForEntries([id]);
  return rowToEntry(row as EntryRow, tagsByEntry.get(id) ?? []);
}

/**
 * Full-representation update: reads the existing row first, returns null
 * when it is absent or already soft-deleted, throws
 * `EntryTypeImmutableError` when `input.type` differs from the stored
 * row's `type`. Otherwise updates `name`/`folder_id`/`notes`/`payload`,
 * replaces the entry's tag links exactly via `setEntryTags`, and refreshes
 * `updated_at`. Updates in place — calling this twice with the identical
 * body leaves exactly one row (idempotent).
 */
export async function updateEntry(id: string, input: EntryUpdateInput): Promise<Entry | null> {
  const db = getDb();
  const existing = await db
    .selectFrom("entries")
    .selectAll()
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .executeTakeFirst();

  if (!existing) return null;
  if (existing.type !== input.type) throw new EntryTypeImmutableError();

  const now = new Date().toISOString();
  const row = await db
    .updateTable("entries")
    .set({
      name: input.name,
      folder_id: input.folderId ?? null,
      notes: input.notes ?? null,
      payload: JSON.stringify(input.payload),
      updated_at: now,
    })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirstOrThrow();

  await setEntryTags(id, input.tags ?? []);
  const tagsByEntry = await tagsForEntries([id]);

  return rowToEntry(row as EntryRow, tagsByEntry.get(id) ?? []);
}

/**
 * Sets `deleted_at` where the id matches and it is not already deleted —
 * this module never issues a hard-delete query against the `entries` table
 * (D-04, source-gated by the plan's own acceptance criteria). Returns
 * whether a row was affected, so the route can answer 404 when the id is
 * absent or already trashed.
 */
export async function softDeleteEntry(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .updateTable("entries")
    .set({ deleted_at: new Date().toISOString() })
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .executeTakeFirst();

  return (result?.numUpdatedRows ?? 0n) > 0n;
}
