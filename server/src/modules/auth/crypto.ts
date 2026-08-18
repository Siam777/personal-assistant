/**
 * Argon2id key derivation and AES-256-GCM envelope wrap/unwrap. Every salt
 * and IV here comes from `node:crypto`'s CSPRNG; nothing in this file is a
 * hand-rolled cipher (RESEARCH.md "Don't Hand-Roll").
 *
 * `deriveMasterKey` runs Argon2id in raw mode (`raw: true`), which returns a
 * Buffer suitable directly as an AES-256 key. Raw mode disables the
 * library's PHC-string check function (PITFALLS.md Pitfall 1) —
 * deliberately: the AES-256-GCM authentication-tag check inside
 * `unwrapKey` is the sole password-correctness oracle for this vault. Do
 * not add a separate PHC-string check call anywhere near this module.
 */

import argon2 from "argon2";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import * as config from "../../config.js";
import type { WrappedBlob } from "../../types.js";

/** Standard AES-256-GCM nonce size. */
const IV_LENGTH_BYTES = 12;

/** The subset of Argon2id cost parameters that vary per vault and are recorded in `vault.meta.json`. */
export interface KdfCostParams {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/**
 * Derives a 32-byte Master Key from the master password and a per-vault
 * salt via Argon2id. Defaults to `config.KDF_PARAMS` for vault creation, but
 * accepts an explicit cost-parameter override so the unlock path can derive
 * using whatever parameters were actually recorded in that vault's sidecar
 * at creation time — a vault created under older or different calibrated
 * parameters must still open even after `config.KDF_PARAMS` changes.
 * Deterministic for a fixed (password, salt, params) triple.
 */
export async function deriveMasterKey(
  password: string,
  salt: Buffer,
  kdfCostParams: KdfCostParams = config.KDF_PARAMS
): Promise<Buffer> {
  return argon2.hash(password, {
    type: config.KDF_PARAMS.type,
    hashLength: config.KDF_PARAMS.hashLength,
    ...kdfCostParams,
    salt,
    raw: true,
  });
}

/**
 * Encrypts `plaintext` with AES-256-GCM under `key`, generating a fresh
 * CSPRNG IV on every call (never reuse, never derive, never cache — IV
 * reuse under GCM can leak the authentication key). Returns the ciphertext,
 * IV, and 16-byte authentication tag, all base64-encoded.
 */
export function wrapKey(plaintext: Buffer, key: Buffer): WrappedBlob {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertextB64: ciphertext.toString("base64"),
    ivB64: iv.toString("base64"),
    authTagB64: authTag.toString("base64"),
  };
}

/**
 * Decrypts a `WrappedBlob` with AES-256-GCM under `key`. `setAuthTag` +
 * `final()` throws on a tag mismatch — that throw IS the password-
 * correctness oracle; callers translate it into `vaultAuthError()` and must
 * never distinguish it from any other unlock failure in the response.
 */
export function unwrapKey(blob: WrappedBlob, key: Buffer): Buffer {
  const iv = Buffer.from(blob.ivB64, "base64");
  const ciphertext = Buffer.from(blob.ciphertextB64, "base64");
  const authTag = Buffer.from(blob.authTagB64, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Generates a fresh random 32-byte Vault Key. */
export function generateVaultKey(): Buffer {
  return randomBytes(32);
}
