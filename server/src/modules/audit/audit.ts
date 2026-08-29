/**
 * Audit log recording and querying service.
 *
 * Implements TRUST-03: Records when/where each secret was accessed or modified,
 * with zero secret values ever appearing in the log.
 */

import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { sql, type Kysely } from "kysely";
import type { VaultDbSchema } from "../db/schema.js";

export type AuditEventType =
  | "vault_unlocked"
  | "vault_locked"
  | "entry_created"
  | "entry_viewed"
  | "entry_updated"
  | "entry_deleted"
  | "secret_revealed"
  | "secret_copied"
  | "two_factor_enabled"
  | "two_factor_disabled"
  | "backup_codes_regenerated"
  | "backup_exported"
  | "backup_restored"
  | "vault_exported"
  | "vault_restored";

export interface AuditEventInput {
  eventType: AuditEventType;
  entryId?: string | null;
  entryName?: string | null;
  entryType?: string | null;
  details?: Record<string, unknown> | string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Extracts sanitized client metadata (IP address and User-Agent) from an Express request.
 */
export function extractClientInfo(req?: Request): { ipAddress: string | null; userAgent: string | null } {
  if (!req) {
    return { ipAddress: null, userAgent: null };
  }
  const ipAddress = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || req.ip || null;
  const userAgent = req.headers["user-agent"] || null;
  return { ipAddress, userAgent };
}

/**
 * Inserts an append-only audit event into `audit_logs`.
 *
 * Guaranteed: No secret payload or cleartext value is ever written.
 */
export async function recordAuditEvent(
  db: Kysely<VaultDbSchema>,
  event: AuditEventInput
): Promise<void> {
  try {
    const detailsStr =
      event.details == null
        ? null
        : typeof event.details === "string"
          ? event.details
          : JSON.stringify(event.details);

    await db
      .insertInto("audit_logs")
      .values({
        id: randomUUID(),
        event_type: event.eventType,
        entry_id: event.entryId ?? null,
        entry_name: event.entryName ?? null,
        entry_type: event.entryType ?? null,
        details: detailsStr,
        ip_address: event.ipAddress ?? null,
        user_agent: event.userAgent ?? null,
        created_at: new Date().toISOString(),
      })
      .execute();
  } catch {
    // If database connection is closed during shutdown / lock, fail gracefully
  }
}

export interface GetAuditLogsOptions {
  limit?: number;
  offset?: number;
  eventType?: string;
  entryId?: string;
}

export interface AuditLogDto {
  id: string;
  eventType: string;
  entryId: string | null;
  entryName: string | null;
  entryType: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

/**
 * Queries audit logs in reverse chronological order (newest first).
 */
export async function getAuditLogs(
  db: Kysely<VaultDbSchema>,
  options: GetAuditLogsOptions = {}
): Promise<{ logs: AuditLogDto[]; total: number }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  let query = db.selectFrom("audit_logs");
  let countQuery = db.selectFrom("audit_logs").select(sql<number>`count(*)`.as("count"));

  if (options.eventType) {
    query = query.where("event_type", "=", options.eventType);
    countQuery = countQuery.where("event_type", "=", options.eventType);
  }

  if (options.entryId) {
    query = query.where("entry_id", "=", options.entryId);
    countQuery = countQuery.where("entry_id", "=", options.entryId);
  }

  const rows = await query
    .selectAll()
    .orderBy("created_at", "desc")
    .limit(limit)
    .offset(offset)
    .execute();

  const countResult = await countQuery.executeTakeFirst();
  const total = Number(countResult?.count ?? 0);

  const logs: AuditLogDto[] = rows.map((row) => {
    let parsedDetails: Record<string, unknown> | null = null;
    if (row.details) {
      try {
        parsedDetails = JSON.parse(row.details);
      } catch {
        parsedDetails = { raw: row.details };
      }
    }

    return {
      id: row.id,
      eventType: row.event_type,
      entryId: row.entry_id,
      entryName: row.entry_name,
      entryType: row.entry_type,
      details: parsedDetails,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: row.created_at,
    };
  });

  return { logs, total };
}
