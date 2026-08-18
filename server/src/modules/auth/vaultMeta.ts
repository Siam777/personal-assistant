/**
 * Read/write for the unencrypted `vault.meta.json` sidecar — the only place
 * KDF parameters and the wrapped Vault Key can live, since
 * better-sqlite3-multiple-ciphers encrypts the whole database file with no
 * partial-plaintext-table option. Every field here is either non-secret
 * (KDF cost parameters, a salt) or a ciphertext blob (SEC-05); never a
 * plaintext master password, derived key, or secret.
 */

import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import * as config from "../../config.js";
import type { VaultMeta } from "../../types.js";

const wrappedBlobSchema = z.object({
  ciphertextB64: z.string(),
  ivB64: z.string(),
  authTagB64: z.string(),
});

const vaultMetaSchema = z.object({
  version: z.literal(1),
  createdAt: z.string(),
  cipher: z.literal("sqlcipher"),
  noRecoveryAcknowledged: z.literal(true),
  kdf: z.object({
    type: z.literal("argon2id"),
    memoryCost: z.number(),
    timeCost: z.number(),
    parallelism: z.number(),
    // WR-02: must be validated (not silently stripped by zod's default
    // unknown-key behavior) — omitting it here would make readVaultMeta()
    // return `hashLength: undefined` for every vault, defeating the whole
    // point of persisting it.
    hashLength: z.number(),
    saltB64: z.string(),
  }),
  wrappedVaultKey: wrappedBlobSchema,
  totp: z.object({
    enabled: z.boolean(),
    wrappedSecret: wrappedBlobSchema.nullable(),
    backupCodeHashes: z.array(z.string()),
  }),
});

/** True only when both the sidecar and the encrypted database file exist. */
export function vaultExists(): boolean {
  return existsSync(config.VAULT_META_PATH) && existsSync(config.VAULT_DB_PATH);
}

/**
 * Creates `config.VAULT_DIR` with mode `0o700` if it does not already
 * exist. `better-sqlite3-multiple-ciphers` requires the parent directory to
 * exist before `new Database(path)` will create the file, so this must run
 * before opening `vault.db` for the first time — not only before writing
 * the sidecar.
 */
export function ensureVaultDir(): void {
  if (!existsSync(config.VAULT_DIR)) {
    mkdirSync(config.VAULT_DIR, { recursive: true, mode: 0o700 });
  }
}

/** Parses and validates the sidecar against the `VaultMeta` contract, throwing on a malformed file. */
export function readVaultMeta(): VaultMeta {
  const raw = readFileSync(config.VAULT_META_PATH, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  return vaultMetaSchema.parse(parsed) as VaultMeta;
}

/**
 * Writes the sidecar via temp-file-then-atomic-rename: write to a sibling
 * temp path, fsync, then rename over the real path. A torn write here
 * destroys the only path back into the vault (D-05 provides no recovery),
 * so this must never be a plain overwrite.
 */
export function writeVaultMetaAtomic(meta: VaultMeta): void {
  ensureVaultDir();

  const tmpPath = path.join(
    config.VAULT_DIR,
    `.vault.meta.json.${randomBytes(8).toString("hex")}.tmp`
  );
  const serialized = JSON.stringify(meta, null, 2);

  const fd = openSync(tmpPath, "w");
  try {
    writeSync(fd, serialized);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  renameSync(tmpPath, config.VAULT_META_PATH);
}
