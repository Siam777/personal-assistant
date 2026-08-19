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
import type { EntryCreateInput, EntryPayload, EntryType } from "./schemas.js";

export interface EntrySummary {
  id: string;
  type: EntryType;
  name: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Entry {
  id: string;
  type: EntryType;
  name: string;
  folderId: string | null;
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
  created_at: string;
  updated_at: string;
}

interface EntryRow extends EntrySummaryRow {
  payload: string;
  notes: string | null;
  deleted_at: string | null;
}

/** Never reads payload/notes columns — this is the mechanism enforcing the
 * "list responses never carry a decrypted secret value" prohibition. */
export function rowToSummary(row: EntrySummaryRow): EntrySummary {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    folderId: row.folder_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    folderId: row.folder_id,
    payload: JSON.parse(row.payload) as EntryPayload,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/**
 * Inserts a new entry row. Never dedupes or upserts: two calls with
 * identical field values produce two rows with distinct ids (VAULT-01
 * idempotency requirement in 02-01-PLAN.md's must_haves).
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

  return rowToEntry(row);
}

/**
 * Non-deleted entries only, ordered by most-recently-updated first, then
 * by id so equal timestamps still have a deterministic, stable order.
 * Selects only summary columns — payload and notes are never read here.
 */
export async function listEntries(): Promise<EntrySummary[]> {
  const db = getDb();
  const rows = await db
    .selectFrom("entries")
    .select(["id", "type", "name", "folder_id", "created_at", "updated_at"])
    .where("deleted_at", "is", null)
    .orderBy("updated_at", "desc")
    .orderBy("id", "asc")
    .execute();

  return rows.map(rowToSummary);
}
