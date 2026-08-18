/**
 * TOTP second-factor enrollment, verification, and single-use backup codes
 * (SEC-03). This module adds no new encryption scheme — the secret is
 * wrapped with the same AES-256-GCM helper (`crypto.ts`) that wraps every
 * other vault secret, and backup codes are SHA-256 digests in the same
 * unencrypted sidecar every other 2FA field lives in.
 *
 * A code alone can never unlock the vault: `verifySecondFactor` takes the
 * Vault Key as a parameter rather than deriving it itself, and the only way
 * a caller has that key is by already having proven the master password
 * (`crypto.ts`'s `unwrapKey`). That is what makes the second factor
 * structurally additive rather than substitutive (see this plan's
 * `must_haves.prohibitions`).
 */

import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import type { EnrollmentResult, EnrollmentStart, VaultMeta } from "../../types.js";
import { unwrapKey, wrapKey } from "./crypto.js";
import { getVaultKey } from "./session.js";
import { readVaultMeta, writeVaultMetaAtomic } from "./vaultMeta.js";

const ISSUER = "PersonalAssistant";
const ACCOUNT_LABEL = "vault";

/** RFC 6238 codes are inherently replayable inside their window (T-04-07,
 * accepted); one 30-second step of tolerance on either side absorbs modest
 * clock drift without widening that window further than necessary. */
const EPOCH_TOLERANCE_SECONDS = 30;

/** A scanned-but-unconfirmed secret must never reach the sidecar (T-04-08) —
 * it lives here only, and expires if the user never confirms it. */
const PENDING_ENROLLMENT_TTL_MS = 5 * 60_000;

const BACKUP_CODE_COUNT = 10;
/** Excludes visually ambiguous characters (0/O, 1/I/L) so codes are easy to
 * transcribe by hand; 32 divides 256 evenly, so `byte % 32` is unbiased. */
const BACKUP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const BACKUP_CODE_GROUP_LENGTH = 4;
const BACKUP_CODE_GROUPS = 2;

interface PendingEnrollment {
  secret: string;
  expiresAt: number;
}

/** Module-private — deliberately never written to the sidecar until a valid
 * code confirms it (T-04-08). Lost on process restart, which is fine: an
 * unconfirmed enrollment was never "on" in the first place. */
const pendingEnrollments = new Map<string, PendingEnrollment>();

function prunePendingEnrollments(): void {
  const now = Date.now();
  for (const [id, entry] of pendingEnrollments) {
    if (entry.expiresAt <= now) {
      pendingEnrollments.delete(id);
    }
  }
}

function hashBackupCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function generateBackupCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < BACKUP_CODE_GROUPS; g++) {
    const bytes = randomBytes(BACKUP_CODE_GROUP_LENGTH);
    let group = "";
    for (let i = 0; i < BACKUP_CODE_GROUP_LENGTH; i++) {
      group += BACKUP_CODE_ALPHABET[(bytes[i] as number) % BACKUP_CODE_ALPHABET.length];
    }
    groups.push(group);
  }
  return groups.join("-");
}

/**
 * Produces ten codes from `randomBytes`, each in a fixed grouped format
 * (`XXXX-XXXX`), and returns both the plaintext codes and their SHA-256 hex
 * digests. A fast hash is correct here rather than Argon2id: the codes are
 * already high-entropy and single-use, so the hash is defense-in-depth
 * against the sidecar being read out of context, not a brute-force barrier.
 */
export function generateBackupCodes(): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const code = generateBackupCode();
    codes.push(code);
    hashes.push(hashBackupCode(code));
  }
  return { codes, hashes };
}

/**
 * Requires an unlocked session. Generates a fresh secret, stores it in the
 * in-memory pending map (never the sidecar) keyed by a random enrollment id
 * with a short expiry, and renders both a scannable QR code and the base32
 * secret for manual entry. This is the one place the secret leaves the
 * server in plaintext, and it goes only to the same local user who is
 * already holding an unlocked vault.
 */
export async function beginEnrollment(): Promise<EnrollmentStart> {
  // Asserts an unlocked session (throws otherwise); the key itself is not
  // needed until confirmation, but the precondition must hold here too.
  getVaultKey();

  prunePendingEnrollments();

  const secret = generateSecret();
  const enrollmentId = randomUUID();
  pendingEnrollments.set(enrollmentId, {
    secret,
    expiresAt: Date.now() + PENDING_ENROLLMENT_TTL_MS,
  });

  const uri = generateURI({ issuer: ISSUER, label: ACCOUNT_LABEL, secret });
  const qrDataUrl = await QRCode.toDataURL(uri);

  return { enrollmentId, qrDataUrl, secret };
}

/**
 * Requires an unlocked session. Verifies the supplied code against the
 * pending secret — reading the `.valid` field explicitly, since a
 * `VerifyResult` object is always truthy regardless of correctness — and
 * only on success wraps the secret with the Vault Key, generates backup
 * codes, and commits `totp.enabled = true` to the sidecar atomically.
 * Returns `null` on an unknown/expired enrollment id or an invalid code,
 * leaving the pending entry (if still present and unexpired) intact so a
 * mistyped code can be retried.
 */
export async function confirmEnrollment(
  enrollmentId: string,
  code: string
): Promise<EnrollmentResult | null> {
  const vaultKey = getVaultKey();
  prunePendingEnrollments();

  const pending = pendingEnrollments.get(enrollmentId);
  if (!pending) {
    return null;
  }

  // A malformed submission (wrong length/format) makes otplib's guardrails
  // throw rather than return an invalid result — treat that identically to
  // a genuinely wrong code rather than letting the exception escape.
  let confirmationValid = false;
  try {
    const result = await verify({
      secret: pending.secret,
      token: code,
      epochTolerance: EPOCH_TOLERANCE_SECONDS,
    });
    confirmationValid = result.valid;
  } catch {
    confirmationValid = false;
  }
  if (!confirmationValid) {
    return null;
  }

  pendingEnrollments.delete(enrollmentId);

  const wrappedSecret = wrapKey(Buffer.from(pending.secret, "utf-8"), vaultKey);
  const { codes, hashes } = generateBackupCodes();

  const meta = readVaultMeta();
  meta.totp = {
    enabled: true,
    wrappedSecret,
    backupCodeHashes: hashes,
  };
  writeVaultMetaAtomic(meta);

  return { backupCodes: codes };
}

/**
 * Called by the unlock handler only after the master password has already
 * been proven (the caller must have already recovered `vaultKey` via
 * `unwrapKey`) — this function never derives a key itself, so a code cannot
 * be checked at all without the password already having unlocked the Vault
 * Key it is decrypted with. Checks the live TOTP code first, reading
 * `.valid` explicitly; on a miss, hashes the supplied value and compares it
 * against a freshly re-read sidecar's `backupCodeHashes` with a length-safe
 * constant-time comparison (WR-06: `meta` is a snapshot the caller read
 * before an ~474ms Argon2id derivation and the live-code check above — both
 * real await points a concurrent backup-code consumption or regeneration
 * can run inside — so the match-and-write step below re-reads instead of
 * trusting that snapshot, closing the window where a stale write would
 * silently lose a concurrent change via last-write-wins). A matched backup
 * code is removed from the array and the sidecar is rewritten atomically
 * before this function returns, so a replay of the same code cannot
 * succeed twice — even within the same second. Returns a plain boolean and
 * never reveals which path (or neither) matched.
 */
export async function verifySecondFactor(
  code: string,
  vaultKey: Buffer,
  meta: VaultMeta
): Promise<boolean> {
  if (!meta.totp.enabled || !meta.totp.wrappedSecret) {
    return false;
  }

  let secret: string;
  try {
    secret = unwrapKey(meta.totp.wrappedSecret, vaultKey).toString("utf-8");
  } catch {
    return false;
  }

  // otplib's guardrails throw (rather than returning an invalid result) on
  // malformed input — e.g. a backup code's length/format never matches a
  // six-digit TOTP token. That throw must not escape this function: a
  // malformed live-code attempt still has to fall through to the
  // backup-code check below, and this function must return a plain
  // boolean either way, never propagate an exception that would let a
  // caller distinguish "wrong code" from "malformed code".
  let liveCodeValid = false;
  try {
    const result = await verify({
      secret,
      token: code,
      epochTolerance: EPOCH_TOLERANCE_SECONDS,
    });
    liveCodeValid = result.valid;
  } catch {
    liveCodeValid = false;
  }
  if (liveCodeValid) {
    return true;
  }

  const candidateHash = Buffer.from(hashBackupCode(code), "hex");

  // Re-read immediately before matching/writing rather than trusting the
  // caller's `meta` snapshot (WR-06). `readVaultMeta`/`writeVaultMetaAtomic`
  // are both synchronous — nothing else can run on Node's single-threaded
  // event loop between these two statements, so this closes the TOCTOU
  // window without needing a separate lock/queue.
  const freshMeta = readVaultMeta();
  const matchIndex = freshMeta.totp.backupCodeHashes.findIndex((storedHex) => {
    const stored = Buffer.from(storedHex, "hex");
    return stored.length === candidateHash.length && timingSafeEqual(stored, candidateHash);
  });

  if (matchIndex === -1) {
    return false;
  }

  const remainingHashes = freshMeta.totp.backupCodeHashes.filter(
    (_, index) => index !== matchIndex
  );
  writeVaultMetaAtomic({
    ...freshMeta,
    totp: { ...freshMeta.totp, backupCodeHashes: remainingHashes },
  });

  return true;
}

/**
 * Clears `totp.enabled`, sets `wrappedSecret` to null, and empties
 * `backupCodeHashes`, writing the sidecar atomically. Callers (the
 * `/2fa/disable` route) are responsible for re-authenticating the master
 * password before calling this — an already-unlocked session is
 * deliberately not sufficient on its own (D-06, T-04-05).
 */
export function disableTotp(): void {
  const meta = readVaultMeta();
  meta.totp = { enabled: false, wrappedSecret: null, backupCodeHashes: [] };
  writeVaultMetaAtomic(meta);
}
