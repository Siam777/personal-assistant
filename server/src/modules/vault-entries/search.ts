/**
 * Filter composition for `GET /entries`: folder equality, tag membership,
 * and a LIKE-based free-text search, all AND-ed together over one query.
 *
 * SQLite `LIKE` rather than FTS5: the expected dataset is small, this
 * stack has no migration runner for an FTS5 virtual table, and there is no
 * existing FTS5 usage anywhere in the codebase to copy (02-PATTERNS.md).
 *
 * This module must never reference the encrypted column on the entries
 * table that holds each entry's type-specific field values — in any
 * select, where, order-by, or join clause. That boundary holds regardless
 * of search mechanism and is asserted both by this plan's source-gate
 * acceptance criteria and by T-02-14 in the phase threat register.
 */

import { sql, type ExpressionBuilder, type SelectQueryBuilder } from "kysely";
import type { VaultDbSchema } from "../db/schema.js";

export interface EntryListFilter {
  q?: string;
  folderId?: string;
  tag?: string;
  deleted?: boolean;
}

const LIKE_ESCAPE_CHAR = "\\";

/**
 * Escapes backslash, percent, and underscore in a user-supplied search
 * term so a query consisting of a bare wildcard character (e.g. a single
 * `%`) matches that character literally instead of matching every row.
 * Backslash is escaped first so the escaping of `%`/`_` cannot itself be
 * reinterpreted.
 */
export function escapeLikePattern(term: string): string {
  return term
    .replaceAll(LIKE_ESCAPE_CHAR, LIKE_ESCAPE_CHAR + LIKE_ESCAPE_CHAR)
    .replaceAll("%", LIKE_ESCAPE_CHAR + "%")
    .replaceAll("_", LIKE_ESCAPE_CHAR + "_");
}

// `folders` is always left-joined by every caller of this module (never
// inner-joined), so every one of its columns is nullable in the query
// builder's DB type by the time it reaches here — mirrors Kysely's own
// `Nullable<T>` transform for a left-joined table exactly, so this type
// structurally matches what `db.selectFrom("entries").leftJoin("folders",
// ...)` actually produces.
type LeftJoinedSchema = Omit<VaultDbSchema, "folders"> & {
  folders: { [K in keyof VaultDbSchema["folders"]]: VaultDbSchema["folders"][K] | null };
};

type EntriesFolderQB<O> = SelectQueryBuilder<LeftJoinedSchema, "entries" | "folders", O>;
type EntriesFolderEB = ExpressionBuilder<LeftJoinedSchema, "entries" | "folders">;

function tagLinkSubquery(eb: EntriesFolderEB) {
  return eb
    .selectFrom("entry_tags")
    .innerJoin("tags", "tags.id", "entry_tags.tag_id")
    .whereRef("entry_tags.entry_id", "=", "entries.id");
}

/**
 * Adds, to a query builder already selecting from `entries` left-joined
 * to `folders`:
 * - the `deleted_at is null` / `is not null` predicate from `filter.deleted`
 * - an equality on `entries.folder_id` when `filter.folderId` is set
 * - an `exists` subquery over `entry_tags`/`tags` when `filter.tag` is set
 * - when `filter.q` is non-empty after trimming, an `or` group of
 *   case-insensitive `like` comparisons (each with an explicit escape
 *   character) against `entries.name`, `folders.name`, and an `exists`
 *   subquery on `tags.name` — every value is bound by Kysely as a
 *   parameter, never concatenated into the SQL text.
 * A blank or whitespace-only `q` adds no predicate at all, so the result
 * comes back unfiltered rather than empty.
 */
export function applyEntryFilters<O>(qb: EntriesFolderQB<O>, filter: EntryListFilter): EntriesFolderQB<O> {
  let query = qb.where("entries.deleted_at", filter.deleted ? "is not" : "is", null);

  if (filter.folderId) {
    query = query.where("entries.folder_id", "=", filter.folderId);
  }

  if (filter.tag) {
    const tagName = filter.tag;
    query = query.where((eb) => eb.exists(tagLinkSubquery(eb).where("tags.name", "=", tagName).select("entry_tags.entry_id")));
  }

  const q = filter.q?.trim();
  if (q) {
    const pattern = `%${escapeLikePattern(q)}%`;
    query = query.where((eb) =>
      eb.or([
        sql<boolean>`${sql.ref("entries.name")} like ${pattern} escape '\\'`,
        sql<boolean>`${sql.ref("folders.name")} like ${pattern} escape '\\'`,
        eb.exists(
          tagLinkSubquery(eb)
            .where(sql<boolean>`${sql.ref("tags.name")} like ${pattern} escape '\\'`)
            .select("entry_tags.entry_id")
        ),
      ])
    );
  }

  return query;
}
