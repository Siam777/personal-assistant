/**
 * Encrypted backup Express router (BACKUP-01, BACKUP-02).
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireUnlocked } from "../../middleware/requireUnlocked.js";
import { validate } from "../../middleware/validate.js";
import { extractClientInfo } from "../audit/audit.js";
import * as session from "../auth/session.js";
import { exportVaultBackup, restoreVaultBackup } from "./backupService.js";
import type { BackupContainer } from "./backupCrypto.js";

export const backupRouter = Router();
backupRouter.use(requireUnlocked);

const exportBodySchema = z.object({
  password: z.string().min(1),
});

/**
 * POST /api/vault/backup/export
 * Exports an AES-256-GCM + Argon2id encrypted backup container of the entire vault.
 */
backupRouter.post(
  "/export",
  validate(exportBodySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { password } = req.body as z.infer<typeof exportBodySchema>;
      const db = session.getDb();
      const clientInfo = extractClientInfo(req);
      const container = await exportVaultBackup(db, password, clientInfo);
      res.json(container);
    } catch (err) {
      next(err);
    }
  }
);

const restoreBodySchema = z.object({
  backupData: z.record(z.string(), z.unknown()),
  password: z.string().min(1),
  mode: z.enum(["merge", "overwrite"]),
});

/**
 * POST /api/vault/backup/restore
 * Decrypts and restores vault data from an encrypted backup container.
 */
backupRouter.post(
  "/restore",
  validate(restoreBodySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { backupData, password, mode } = req.body as z.infer<typeof restoreBodySchema>;
      const db = session.getDb();
      const clientInfo = extractClientInfo(req);
      const result = await restoreVaultBackup(
        db,
        backupData as unknown as BackupContainer,
        password,
        mode,
        clientInfo
      );
      res.json(result);
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("Invalid backup password") ||
          err.message.includes("Unsupported or invalid backup format"))
      ) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  }
);
