import type { NextFunction, Request, Response } from "express";
import * as config from "../config.js";
import { logError } from "../log.js";

/**
 * Rejects cross-origin state-changing requests (WR-04). The loopback bind
 * (D-02) only stops other *machines* from reaching this API — it does
 * nothing to stop a malicious page open in another tab of the *same*
 * browser from issuing a "simple request" (a hidden auto-submitting
 * `<form>` POST, or `navigator.sendBeacon`) directly to
 * `http://127.0.0.1:5174/api/vault/*`, since neither needs a CORS
 * preflight. There is no session cookie or CSRF token anywhere in this
 * server, so an `Origin` check is the cheapest correct defense available.
 *
 * `GET`/`HEAD`/`OPTIONS` are read-only and left alone. Every other method
 * must either carry no `Origin` header at all (non-browser clients — curl,
 * this project's own test harness, neither of which ever sets one) or an
 * `Origin` that is a member of `config.ALLOWED_ORIGINS` — the Vite dev
 * server, the only legitimate same-origin caller in this project's current
 * single-environment topology, reachable as either `127.0.0.1` or
 * `localhost`.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireSameOriginForMutations(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.headers.origin;
  if (origin !== undefined && !config.ALLOWED_ORIGINS.has(origin)) {
    logError("rejected cross-origin state-changing request", {
      method: req.method,
      path: req.path,
      // The Origin header itself is not secret — it identifies the
      // requesting page, never vault contents — so it is safe to log here,
      // unlike the request body this handler never touches.
      origin,
    });
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  next();
}
