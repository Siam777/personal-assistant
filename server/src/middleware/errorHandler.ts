import type { ErrorRequestHandler } from "express";
import { logError } from "../log.js";

/**
 * Tagged error carrying `code === "VAULT_AUTH"`. Every unlock-path failure —
 * wrong password, wrong second factor, corrupt vault — must construct its
 * failure through this single function, so no call site can hand-build a
 * message that would let a response distinguish one failure cause from
 * another (PITFALLS.md Security Mistakes: generic "Unable to unlock").
 */
export function vaultAuthError(): Error & { code: "VAULT_AUTH" } {
  const err = new Error("VAULT_AUTH") as Error & { code: "VAULT_AUTH" };
  err.code = "VAULT_AUTH";
  return err;
}

/**
 * Four-argument Express error handler, registered last in the middleware
 * chain. Reports through `logError` (never the request body) and collapses
 * every error to one of two generic responses:
 *   - VAULT_AUTH-tagged errors -> 401 { error: "Unable to unlock" }
 *   - anything else            -> 500 { error: "Internal error" }
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const isVaultAuthError =
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "VAULT_AUTH";

  logError("request failed", {
    method: req.method,
    path: req.path,
    isVaultAuthError,
    // Deliberately no request body, no stack trace value, no error message —
    // any of those could carry secret material typed into an unlock form.
  });

  if (isVaultAuthError) {
    res.status(401).json({ error: "Unable to unlock" });
    return;
  }

  res.status(500).json({ error: "Internal error" });
};
