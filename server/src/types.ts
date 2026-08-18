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
    // Recorded per-vault (WR-02) so a future change to
    // `config.KDF_PARAMS.hashLength` cannot silently re-derive every
    // existing vault's Master Key at a different length and turn every
    // unlock attempt into an indistinguishable "wrong password" failure.
    hashLength: number;
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

/**
 * Returned by `POST /api/vault/2fa/enroll` (Plan 01-04). `secret` is the
 * base32 TOTP secret in plaintext — the one place it ever leaves the server,
 * and only to the same local user who already holds an unlocked vault. It is
 * never persisted in this form; a confirmed enrollment stores only the
 * Vault-Key-wrapped ciphertext.
 */
export interface EnrollmentStart {
  enrollmentId: string;
  qrDataUrl: string;
  secret: string;
}

/**
 * Returned by `POST /api/vault/2fa/confirm` and by backup-code regeneration
 * (Plan 01-04). `backupCodes` are plaintext and exist in exactly this one
 * response body — the sidecar stores only their SHA-256 digests, and no
 * endpoint ever returns them again.
 */
export interface EnrollmentResult {
  backupCodes: string[];
}
