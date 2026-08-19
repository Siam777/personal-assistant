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

/**
 * Returned by `POST /api/vault/2fa/enroll`. `secret` is the base32 TOTP
 * secret in plaintext — the one place it ever reaches the browser, and only
 * to the same local user who already holds an unlocked vault.
 */
export interface EnrollmentStart {
  enrollmentId: string;
  qrDataUrl: string;
  secret: string;
}

/**
 * Returned by `POST /api/vault/2fa/confirm` and by backup-code
 * regeneration. These plaintext codes exist in exactly this one response —
 * no endpoint ever returns them again.
 */
export interface EnrollmentResult {
  backupCodes: string[];
}

/** Requires an unlocked session. Starts a new pending enrollment; nothing is committed until `confirmTwoFactorEnrollment` succeeds. */
export function beginTwoFactorEnrollment(): Promise<EnrollmentStart> {
  return postJson<EnrollmentStart>("/api/vault/2fa/enroll", {});
}

/**
 * Requires an unlocked session AND the master password, re-verified
 * server-side even though the vault is already unlocked (CR-01) — the same
 * re-auth requirement `disableTwoFactor`/`regenerateBackupCodes` already
 * carry, closing the gap where a successful code guess could otherwise
 * attach an attacker-chosen second factor without ever proving the
 * password. On success, 2FA is now on and the returned codes are the only
 * time they are ever shown.
 */
export function confirmTwoFactorEnrollment(
  enrollmentId: string,
  code: string,
  masterPassword: string
): Promise<EnrollmentResult> {
  return postJson<EnrollmentResult>("/api/vault/2fa/confirm", {
    enrollmentId,
    code,
    masterPassword,
  });
}

/**
 * Requires an unlocked session AND the master password, re-verified
 * server-side even though the vault is already unlocked (D-06). The
 * response body is empty on success (204), so this does not go through
 * `postJson`, which always parses a JSON body.
 */
export async function disableTwoFactor(masterPassword: string): Promise<void> {
  const res = await fetch("/api/vault/2fa/disable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ masterPassword }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorMessage(res));
  }
}

/** Requires an unlocked session AND the master password (D-06). Replaces the whole backup-code set, invalidating every previous code. */
export function regenerateBackupCodes(masterPassword: string): Promise<EnrollmentResult> {
  return postJson<EnrollmentResult>("/api/vault/2fa/backup-codes/regenerate", {
    masterPassword,
  });
}

// --- Vault entries (Phase 2) ---------------------------------------------

export type EntryType = "api_key" | "login" | "note" | "card";

export interface ApiKeyPayload {
  key: string;
  endpoint?: string;
  model?: string;
}

export interface LoginPayload {
  username: string;
  password: string;
  url?: string;
}

export interface NotePayload {
  body: string;
}

export interface CardPayload {
  number: string;
  expiry: string;
  cvv: string;
  cardholder?: string;
}

export type EntryPayload = ApiKeyPayload | LoginPayload | NotePayload | CardPayload;

/**
 * Returned by `GET /api/vault/entries`. Deliberately carries no `payload`
 * and no `notes` property — the list endpoint never returns a decrypted
 * secret value, only the entry a user explicitly opens does.
 */
export interface EntrySummary {
  id: string;
  type: EntryType;
  name: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Entry {
  id: string;
  type: EntryType;
  name: string;
  folderId: string | null;
  payload: EntryPayload;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface EntryCreateInput {
  type: EntryType;
  name: string;
  folderId?: string | null;
  notes?: string | null;
  tags?: string[];
  payload: EntryPayload;
}

/** Requires an unlocked session. Non-deleted entries only. */
export async function listEntries(): Promise<EntrySummary[]> {
  const res = await fetch("/api/vault/entries");
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorMessage(res));
  }
  return (await res.json()) as EntrySummary[];
}

/** Requires an unlocked session. Never dedupes — repeat calls with identical input create distinct rows. */
export function createEntry(input: EntryCreateInput): Promise<Entry> {
  return postJson<Entry>("/api/vault/entries", input);
}

/** Requires an unlocked session. The only client call that returns a decrypted secret payload. 404s surface as `ApiError`. */
export async function getEntry(id: string): Promise<Entry> {
  const res = await fetch(`/api/vault/entries/${id}`);
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorMessage(res));
  }
  return (await res.json()) as Entry;
}

/**
 * Requires an unlocked session. Full-representation update — submit every
 * mutable field, not a partial patch. The server rejects a body whose
 * `type` differs from the stored entry's type with 400 (entry type is
 * immutable after creation).
 */
export async function updateEntry(id: string, input: EntryCreateInput): Promise<Entry> {
  const res = await fetch(`/api/vault/entries/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorMessage(res));
  }
  return (await res.json()) as Entry;
}

/**
 * Requires an unlocked session. Moves the entry to trash (soft delete, not
 * a hard delete). The response body is empty on success (204), so this
 * does not go through `postJson`, which always parses a JSON body — same
 * precedent as `disableTwoFactor`.
 */
export async function deleteEntry(id: string): Promise<void> {
  const res = await fetch(`/api/vault/entries/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorMessage(res));
  }
}
