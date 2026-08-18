import path from "node:path";
import argon2 from "argon2";

/**
 * Single source of truth for every tunable this server reads. No module
 * outside this file may hardcode a host, port, vault path, timeout, or KDF
 * parameter — that is what keeps D-02's "loopback only" and D-03's "5-minute
 * idle timeout" mechanically true instead of scattered literals someone can
 * silently drift.
 */

/** The API must never bind to anything other than loopback (D-02, PITFALLS.md Pitfall 5). */
export const HOST = "127.0.0.1";

export const PORT = 5174;

/**
 * Root directory for the vault's on-disk files. Overridable via the
 * `VAULT_DIR` environment variable so tests can point it at a throwaway
 * temp directory instead of the real `.vault/` under the repo root.
 */
export const VAULT_DIR = process.env.VAULT_DIR ?? path.join(process.cwd(), ".vault");

/** Whole-file encrypted SQLite database (better-sqlite3-multiple-ciphers, sqlcipher mode). */
export const VAULT_DB_PATH = path.join(VAULT_DIR, "vault.db");

/** Unencrypted sidecar: KDF params, wrapped Vault Key, TOTP blob — never a plaintext secret. */
export const VAULT_META_PATH = path.join(VAULT_DIR, "vault.meta.json");

/**
 * D-03: 5-minute server-authoritative idle timeout. On expiry the session
 * module must zero the in-memory Vault Key, not just flip a UI flag
 * (PITFALLS.md Pitfall 3).
 */
export const IDLE_TIMEOUT_MS = 5 * 60_000;

/** Minimum @zxcvbn-ts/core score (0-4 scale) accepted for a new master password. */
export const MIN_PASSWORD_SCORE = 3;

/**
 * Calibrated Argon2id cost parameters, measured via `npm run bench:kdf` on
 * the real target machine (research assumption A6).
 *
 * `01-RESEARCH.md`'s starting values (memoryCost=131072, timeCost=3,
 * parallelism=4) measured a 128.27 ms median on this machine (Node
 * 20.19.6) — below the 300-2000 ms target window. Raised to
 * memoryCost=262144 (256 MiB), timeCost=6, parallelism=4, which measured a
 * 474.04 ms median over 5 runs (individual runs: 440.11, 533.31, 474.04,
 * 450.52, 499.54 ms) — inside the window and near the ~0.5s unlock-latency
 * target from `ARCHITECTURE.md` Scaling Priorities.
 *
 * `must_haves.prohibitions` (SEC-01): lowering these values below the
 * measured target to make unlock feel faster is forbidden unless the new
 * values and their own measured timing are recorded in this comment — never
 * as an undocumented tweak.
 */
export const KDF_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 262144, // 256 MiB
  timeCost: 6,
  parallelism: 4,
  hashLength: 32,
} as const;
