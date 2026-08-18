/**
 * Typed fetch wrapper for the local API. All requests go through the Vite
 * dev-server proxy at `/api`, which forwards to the loopback-only Express
 * server (server/src/app.ts). This module never persists a secret to Web
 * Storage — it only shuttles requests/responses through fetch.
 */

export interface VaultStatus {
  initialized: boolean;
  unlocked: boolean;
  totpEnabled: boolean;
  idleTimeoutMs: number;
}

/**
 * Thrown for any non-2xx API response. Carries the HTTP status and the
 * server's generic message only — the server's error handler never sends
 * detail beyond `{ error: string }`, so there is nothing more specific to
 * surface here.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

export async function getStatus(): Promise<VaultStatus> {
  const res = await fetch("/api/vault/status");
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorMessage(res));
  }
  return (await res.json()) as VaultStatus;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorMessage(res));
  }
  return (await res.json()) as T;
}

/**
 * Thrown specifically for a `POST /api/vault/init` 400 response so the
 * caller can render the server's `score`/`feedback` fields rather than the
 * generic error message.
 */
export class WeakPasswordError extends ApiError {
  readonly score: number | undefined;
  readonly feedback: string | undefined;

  constructor(status: number, message: string, score?: number, feedback?: string) {
    super(status, message);
    this.name = "WeakPasswordError";
    this.score = score;
    this.feedback = feedback;
  }
}

export async function initVault(
  masterPassword: string,
  noRecoveryAcknowledged: true
): Promise<VaultStatus> {
  const res = await fetch("/api/vault/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ masterPassword, noRecoveryAcknowledged }),
  });

  if (!res.ok) {
    const body = (await res
      .json()
      .catch(() => ({}))) as { error?: string; score?: number; feedback?: string };
    throw new WeakPasswordError(
      res.status,
      body.error ?? res.statusText,
      body.score,
      body.feedback
    );
  }

  return (await res.json()) as VaultStatus;
}

/**
 * Submits the master password (and, once Plan 01-04 enables it, a TOTP
 * code) in one request. On a non-2xx response, `ApiError.message` carries
 * exactly the server's generic failure text and nothing more — callers must
 * not attempt to interpret or re-word it (see `<assumption_delta_decision>`
 * in 01-03-PLAN.md for why the request already carries an optional
 * `totpCode`).
 */
export async function unlockVault(
  masterPassword: string,
  totpCode?: string
): Promise<VaultStatus> {
  return postJson<VaultStatus>("/api/vault/unlock", { masterPassword, totpCode });
}

/**
 * Fire-and-forget lock request. Safe to call whether or not a session is
 * currently live — the server's `POST /lock` is idempotent. `keepalive`
 * lets this survive a page that is closing or backgrounding, which is the
 * whole reason `session-signals.ts` calls this rather than `postJson`.
 */
export function lockVault(): Promise<Response> {
  return fetch("/api/vault/lock", { method: "POST", keepalive: true });
}
