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
