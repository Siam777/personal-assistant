/**
 * Audit log Express router.
 *
 * All routes require an active, unlocked vault session (`requireUnlocked`).
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireUnlocked } from "../../middleware/requireUnlocked.js";
import { validate } from "../../middleware/validate.js";
import { getAuditLogs, recordAuditEvent, extractClientInfo, type AuditEventType } from "./audit.js";
import * as session from "../auth/session.js";

export const auditRouter = Router();
auditRouter.use(requireUnlocked);

const queryAuditLogsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  eventType: z.string().optional(),
  entryId: z.string().optional(),
});

/**
 * GET /api/vault/audit
 * Returns paginated audit log records in reverse chronological order.
 */
auditRouter.get(
  "/",
  validate(queryAuditLogsSchema, "query"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = session.getDb();
      const queryParams = ((req as unknown as { validatedQuery: unknown }).validatedQuery ??
        req.query) as z.infer<typeof queryAuditLogsSchema>;
      const { limit, offset, eventType, entryId } = queryParams;
      const result = await getAuditLogs(db, { limit, offset, eventType, entryId });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

const recordClientEventSchema = z.object({
  eventType: z.enum(["secret_revealed", "secret_copied", "vault_locked"]),
  entryId: z.string().optional(),
  entryName: z.string().optional(),
  entryType: z.string().optional(),
  fieldName: z.string().max(50).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

/**
 * POST /api/vault/audit/events
 * Allows the client to record user actions such as revealing or copying a secret field.
 * Explicitly forbids secret strings in the payload.
 */
auditRouter.post(
  "/events",
  validate(recordClientEventSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = session.getDb();
      const body = req.body as z.infer<typeof recordClientEventSchema>;
      const clientInfo = extractClientInfo(req);

      const details = {
        ...(body.details ?? {}),
        ...(body.fieldName ? { fieldName: body.fieldName } : {}),
      };

      await recordAuditEvent(db, {
        eventType: body.eventType as AuditEventType,
        entryId: body.entryId ?? null,
        entryName: body.entryName ?? null,
        entryType: body.entryType ?? null,
        details,
        ipAddress: clientInfo.ipAddress,
        userAgent: clientInfo.userAgent,
      });

      res.status(201).json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);
