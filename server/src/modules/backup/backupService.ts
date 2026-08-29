/**
 * Backup export and restore service (BACKUP-01, BACKUP-02).
 */

import type { Kysely } from "kysely";
import type { VaultDbSchema } from "../db/schema.js";
import {
  createEncryptedBackup,
  decryptBackup,
  type BackupContainer,
  type BackupPayload,
} from "./backupCrypto.js";
import { recordAuditEvent } from "../audit/audit.js";

export interface ClientInfo {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Exports all current vault data (entries, folders, tags, linkages) as an encrypted backup.
 */
export async function exportVaultBackup(
  db: Kysely<VaultDbSchema>,
  password: string,
  clientInfo: ClientInfo = {}
): Promise<BackupContainer> {
  const [entries, folders, tags, entryTags] = await Promise.all([
    db.selectFrom("entries").selectAll().execute(),
    db.selectFrom("folders").selectAll().execute(),
    db.selectFrom("tags").selectAll().execute(),
    db.selectFrom("entry_tags").selectAll().execute(),
  ]);

  const payload: BackupPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: entries.map((e) => ({
      id: e.id,
      type: e.type,
      name: e.name,
      payload: e.payload,
      folder_id: e.folder_id,
      notes: e.notes,
      created_at: e.created_at,
      updated_at: e.updated_at,
      deleted_at: e.deleted_at,
    })),
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      created_at: f.created_at,
    })),
    tags: tags.map((t) => ({
      id: t.id,
      name: t.name,
      created_at: t.created_at,
    })),
    entry_tags: entryTags.map((et) => ({
      entry_id: et.entry_id,
      tag_id: et.tag_id,
    })),
  };

  const container = await createEncryptedBackup(payload, password);

  await recordAuditEvent(db, {
    eventType: "backup_exported",
    details: { entryCount: entries.length },
    ipAddress: clientInfo.ipAddress,
    userAgent: clientInfo.userAgent,
  });

  return container;
}

/**
 * Restores vault data from an encrypted backup container.
 */
export async function restoreVaultBackup(
  db: Kysely<VaultDbSchema>,
  container: BackupContainer,
  password: string,
  mode: "merge" | "overwrite",
  clientInfo: ClientInfo = {}
): Promise<{ restoredCount: number; mode: string }> {
  const payload = await decryptBackup(container, password);

  await db.transaction().execute(async (trx) => {
    if (mode === "overwrite") {
      await trx.deleteFrom("entry_tags").execute();
      await trx.deleteFrom("entries").execute();
      await trx.deleteFrom("folders").execute();
      await trx.deleteFrom("tags").execute();

      if (payload.folders.length > 0) {
        await trx.insertInto("folders").values(payload.folders).execute();
      }
      if (payload.tags.length > 0) {
        await trx.insertInto("tags").values(payload.tags).execute();
      }
      if (payload.entries.length > 0) {
        await trx.insertInto("entries").values(payload.entries).execute();
      }
      if (payload.entry_tags.length > 0) {
        await trx.insertInto("entry_tags").values(payload.entry_tags).execute();
      }
    } else {
      // Merge mode: insert or replace entries and metadata without deleting untouched items
      for (const folder of payload.folders) {
        await trx
          .insertInto("folders")
          .values(folder)
          .onConflict((oc) => oc.column("id").doUpdateSet({
            name: folder.name,
          }))
          .execute();
      }

      for (const tag of payload.tags) {
        await trx
          .insertInto("tags")
          .values(tag)
          .onConflict((oc) => oc.column("name").doNothing())
          .execute();
      }

      for (const entry of payload.entries) {
        await trx
          .insertInto("entries")
          .values(entry)
          .onConflict((oc) => oc.column("id").doUpdateSet({
            name: entry.name,
            type: entry.type,
            payload: entry.payload,
            folder_id: entry.folder_id,
            notes: entry.notes,
            updated_at: entry.updated_at,
            deleted_at: entry.deleted_at,
          }))
          .execute();
      }

      for (const et of payload.entry_tags) {
        await trx
          .insertInto("entry_tags")
          .values(et)
          .onConflict((oc) => oc.columns(["entry_id", "tag_id"]).doNothing())
          .execute();
      }
    }
  });

  await recordAuditEvent(db, {
    eventType: "backup_restored",
    details: { mode, entryCount: payload.entries.length },
    ipAddress: clientInfo.ipAddress,
    userAgent: clientInfo.userAgent,
  });

  return {
    restoredCount: payload.entries.length,
    mode,
  };
}
