/**
 * In-memory backoff scoped to `POST /api/vault/unlock` only. Never mounted
 * on `/status` or `/lock` — both are called automatically by the client
 * (polling and page-lifecycle hooks respectively), and rate-limiting either
 * would throttle normal operation rather than an attacker.
 *
 * Deliberately no permanent lockout: D-05 provides no password-recovery
 * path, so a durable lockout would destroy the vault as effectively as an
 * attacker would (see 01-03-PLAN.md threat T-03-08). The window resets on
 * process restart and after `windowMs` elapses — this is throttling, not an
 * account-lockout mechanism.
 */

import { rateLimit } from "express-rate-limit";
import { vaultAuthError } from "./errorHandler.js";

export const unlockRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Forwards to the same errorHandler.ts path every other unlock failure
  // takes, rather than writing a second, independent JSON response body
  // here — so a rate-limited response is byte-identical to a wrong-password
  // response and never announces that a limit, rather than a wrong
  // password, was the cause.
  handler: (_req, _res, next) => {
    next(vaultAuthError());
  },
});

/**
 * Same policy as `unlockRateLimit`, mounted on `POST /api/vault/2fa/confirm`
 * (CR-01). Without this, confirmation is a cheap, sub-millisecond otplib
 * check with no Argon2id cost gating it, unlike every other auth-tag/password
 * check in this module — a 6-digit code is a 10^6 search space that is
 * brute-forceable well within `PENDING_ENROLLMENT_TTL_MS` at loopback speed.
 * Reuses the same `vaultAuthError()` forwarding for the same reason
 * `unlockRateLimit` does: a rate-limited response must stay indistinguishable
 * from a wrong-code/wrong-password response.
 */
export const twoFactorConfirmRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(vaultAuthError());
  },
});
