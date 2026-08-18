import type { NextFunction, Request, Response } from "express";
import { armIdleTimer, isUnlocked } from "../modules/auth/session.js";

/**
 * Gates every `/api/vault/*` route that needs an unlocked vault. Responds
 * HTTP 401 `{ error: "Vault is locked" }` when the session reports locked;
 * otherwise arms the idle timer and continues. This is the single place in
 * the server the idle timer is reset (D-03) — no route handler resets it
 * directly.
 */
export function requireUnlocked(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isUnlocked()) {
    res.status(401).json({ error: "Vault is locked" });
    return;
  }
  armIdleTimer();
  next();
}
