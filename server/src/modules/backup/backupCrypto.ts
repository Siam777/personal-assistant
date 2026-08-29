/**
 * Cryptographic engine for vault backup container export & restore (BACKUP-01, BACKUP-02).
 *
 * Encapsulates the entire vault dataset within an AES-256-GCM container encrypted
 * using an Argon2id-derived key from the user-provided backup password.
 */

import { randomBytes } from "node:crypto";
import * as config from "../../config.js";
import { deriveMasterKey, unwrapKey, wrapKey } from "../auth/crypto.js";

export interface BackupContainer {
  version: 1;
  createdAt: string;
  app: "personal-assistant-vault";
  kdf: {
    type: "argon2id";
    memoryCost: number;
    timeCost: number;
    parallelism: number;
    hashLength: number;
    saltB64: string;
  };
  encryption: {
    cipher: "aes-256-gcm";
    ivB64: string;
    authTagB64: string;
  };
  ciphertextB64: string;
}

export interface BackupPayload {
  version: 1;
  exportedAt: string;
  entries: Array<{
    id: string;
    type: "api_key" | "login" | "note" | "card";
    name: string;
    payload: string;
    folder_id: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  }>;
  folders: Array<{
    id: string;
    name: string;
    created_at: string;
  }>;
  tags: Array<{
    id: string;
    name: string;
    created_at: string;
  }>;
  entry_tags: Array<{
    entry_id: string;
    tag_id: string;
  }>;
}

/**
 * Serializes and encrypts `payload` into a standalone, portable `BackupContainer`.
 */
export async function createEncryptedBackup(
  payload: BackupPayload,
  password: string
): Promise<BackupContainer> {
  const salt = randomBytes(16);
  const key = await deriveMasterKey(password, salt);
  try {
    const plaintextBuffer = Buffer.from(JSON.stringify(payload), "utf8");
    const wrapped = wrapKey(plaintextBuffer, key);

    return {
      version: 1,
      createdAt: new Date().toISOString(),
      app: "personal-assistant-vault",
      kdf: {
        type: "argon2id",
        memoryCost: config.KDF_PARAMS.memoryCost,
        timeCost: config.KDF_PARAMS.timeCost,
        parallelism: config.KDF_PARAMS.parallelism,
        hashLength: config.KDF_PARAMS.hashLength,
        saltB64: salt.toString("base64"),
      },
      encryption: {
        cipher: "aes-256-gcm",
        ivB64: wrapped.ivB64,
        authTagB64: wrapped.authTagB64,
      },
      ciphertextB64: wrapped.ciphertextB64,
    };
  } finally {
    key.fill(0);
  }
}

/**
 * Authenticates and decrypts a `BackupContainer` using the supplied backup password.
 * Throws if the file format is invalid, if password is incorrect, or if authentication tag fails.
 */
export async function decryptBackup(
  container: BackupContainer,
  password: string
): Promise<BackupPayload> {
  if (
    typeof container !== "object" ||
    container === null ||
    container.version !== 1 ||
    container.app !== "personal-assistant-vault" ||
    !container.kdf?.saltB64 ||
    !container.encryption?.ivB64 ||
    !container.encryption?.authTagB64 ||
    !container.ciphertextB64
  ) {
    throw new Error("Unsupported or invalid backup format");
  }

  const salt = Buffer.from(container.kdf.saltB64, "base64");
  const key = await deriveMasterKey(password, salt, {
    memoryCost: container.kdf.memoryCost,
    timeCost: container.kdf.timeCost,
    parallelism: container.kdf.parallelism,
    hashLength: container.kdf.hashLength,
  });

  try {
    const decryptedBuffer = unwrapKey(
      {
        ciphertextB64: container.ciphertextB64,
        ivB64: container.encryption.ivB64,
        authTagB64: container.encryption.authTagB64,
      },
      key
    );

    const jsonStr = decryptedBuffer.toString("utf8");
    const parsed = JSON.parse(jsonStr) as BackupPayload;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      throw new Error("Malformed backup data structure");
    }
    return parsed;
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Malformed backup data structure") {
      throw err;
    }
    throw new Error("Invalid backup password or corrupted backup file");
  } finally {
    key.fill(0);
  }
}
