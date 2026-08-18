/**
 * Type contracts created by Plan 01-01 and implemented against by Plans
 * 01-02 through 01-04. Field names and shapes here are load-bearing —
 * do not add or rename fields without updating every later plan.
 */

export interface WrappedBlob {
  ciphertextB64: string;
  ivB64: string;
  authTagB64: string;
}

export interface VaultMeta {
  version: 1;
  createdAt: string; // ISO timestamp
  cipher: "sqlcipher"; // whole-DB cipher mode, recorded so a future re-key can migrate
  noRecoveryAcknowledged: true;
  kdf: {
    type: "argon2id";
    memoryCost: number;
    timeCost: number;
    parallelism: number;
    saltB64: string; // >=16 random bytes, base64 — NOT secret
  };
  wrappedVaultKey: WrappedBlob;
  totp: {
    enabled: boolean;
    wrappedSecret: WrappedBlob | null; // encrypted with the Vault Key (Plan 01-04)
    backupCodeHashes: string[]; // SHA-256 hex digests (Plan 01-04)
  };
}

export interface VaultStatus {
  initialized: boolean;
  unlocked: boolean;
  totpEnabled: boolean;
  idleTimeoutMs: number;
}
