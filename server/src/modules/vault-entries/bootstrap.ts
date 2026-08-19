/**
 * The only schema-bootstrap entry point for the vault module. This stack
 * has no separate migration runner (`.planning/research/STACK.md` — "no
 * ORM push/migrate command"), so "running the migration" means opening the
 * vault: `onVaultOpened` is called on both the `/init` and `/unlock` paths
 * in `auth/routes.ts`, and `initSchema` is idempotent (`.ifNotExists()` on
 * every table/index, and the `schema_version` row is inserted only once),
 * so calling this on every open is safe and is what makes a vault created
 * before this phase gain the new tables the first time it is unlocked.
 *
 * Plan 02-04 adds the expired-trash purge to this same function, which is
 * why this exists as a seam rather than call sites invoking `initSchema`
 * directly.
 */

import type { Kysely } from "kysely";
import { initSchema } from "../db/connection.js";
import type { VaultDbSchema } from "../db/schema.js";
import { purgeExpiredTrash } from "./entries.js";

export async function onVaultOpened(db: Kysely<VaultDbSchema>): Promise<void> {
  await initSchema(db);
  await purgeExpiredTrash(db);
}
