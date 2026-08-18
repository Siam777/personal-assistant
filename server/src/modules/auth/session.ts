/**
 * Module-scoped singleton holding the unlocked-session state: the Vault Key
 * Buffer, the open Kysely handle, and the server-authoritative idle timer.
 * A single-user local app has exactly one global unlocked/locked state —
 * this is correct, not a simplification.
 */

import type { Kysely } from "kysely";
import * as config from "../../config.js";
import type { VaultDbSchema } from "../db/schema.js";

let vaultKey: Buffer | null = null;
let db: Kysely<VaultDbSchema> | null = null;
let idleTimer: NodeJS.Timeout | null = null;

// Captured by lock() purely so the test-only observability accessor below
// can report "was this buffer actually zeroed" without ever exposing key
// bytes to a caller. Not read anywhere else in this module.
let lastLockedBufferRef: Buffer | null = null;

export function isUnlocked(): boolean {
  return vaultKey !== null;
}

/** Throws rather than returning null when locked, so no caller can operate on a dead handle by accident. */
export function getVaultKey(): Buffer {
  if (vaultKey === null) {
    throw new Error("Vault is locked");
  }
  return vaultKey;
}

/** Throws rather than returning null when locked, so no caller can operate on a dead handle by accident. */
export function getDb(): Kysely<VaultDbSchema> {
  if (db === null) {
    throw new Error("Vault is locked");
  }
  return db;
}

/** Takes custody of a freshly-derived Vault Key and its open database handle, and arms the idle timer. */
export function unlockSession(key: Buffer, database: Kysely<VaultDbSchema>): void {
  vaultKey = key;
  db = database;
  armIdleTimer();
}

/** Clears any existing timer and arms a new one for `config.IDLE_TIMEOUT_MS`, firing `lock`. */
export function armIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(lock, config.IDLE_TIMEOUT_MS);
}

/**
 * Zeroes the key buffer, closes the database handle, and clears the timer
 * — all four steps in one synchronous function body with no early return.
 * Splitting these across separate call sites is exactly the half-
 * implemented-lock failure mode PITFALLS.md documents (Pitfall 3/4).
 */
export function lock(): void {
  if (vaultKey) {
    lastLockedBufferRef = vaultKey;
    vaultKey.fill(0);
  }
  vaultKey = null;

  if (db) {
    // Fire-and-forget, but never unhandled (WR-03): every other call site
    // that closes a Kysely handle wraps it in try/catch, and this is the
    // one place with no external trigger to observe or retry a failure —
    // an unhandled rejection here can crash the whole process under
    // Node's default behavior, defeating the very auto-lock this function
    // implements.
    db.destroy().catch(() => {
      // best-effort close; the vault is already considered locked either way
    });
  }
  db = null;

  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  idleTimer = null;
}

/**
 * Test-only observability. "The key was zeroed" is otherwise unobservable
 * from outside this module — an unobservable security property is one that
 * silently regresses — so this reports a boolean summary only, never the
 * buffer itself or any of its bytes. Inert (returns `null`) unless running
 * under Vitest, so this accessor cannot become a runtime side-channel in a
 * shipped build.
 */
export function __unsafeTestOnlyObserveSession(): {
  hasKeyMaterial: boolean;
  lastLockedBufferIsAllZero: boolean | null;
} | null {
  if (process.env.VITEST !== "true") {
    return null;
  }
  return {
    hasKeyMaterial: vaultKey !== null,
    lastLockedBufferIsAllZero:
      lastLockedBufferRef === null
        ? null
        : lastLockedBufferRef.every((byte) => byte === 0),
  };
}
