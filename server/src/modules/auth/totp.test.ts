/**
 * Unit-level proof for `totp.ts`: enrollment only commits on a code that
 * genuinely verifies against the enrolled secret, the `.valid` field on
 * otplib's `VerifyResult` is read explicitly rather than the result
 * object's truthiness, backup codes hash correctly and are single-use, and
 * the sidecar never contains the plaintext secret in any encoding after a
 * confirmed enrollment. Each test gets a fresh temp `VAULT_DIR` and a fresh
 * module registry, mirroring `unlock.test.ts`'s harness.
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { generate, generateSecret } from "otplib";
import { afterEach, describe, expect, it, vi } from "vitest";

interface Harness {
  vaultDir: string;
  baseUrl: string;
  config: typeof import("../../config.js");
  vaultMeta: typeof import("./vaultMeta.js");
  session: typeof import("./session.js");
  totp: typeof import("./totp.js");
  close: () => Promise<void>;
}

async function startFreshApp(): Promise<Harness> {
  const vaultDir = path.join(
    os.tmpdir(),
    `vault-totp-test-${randomBytes(8).toString("hex")}`
  );
  process.env.VAULT_DIR = vaultDir;
  vi.resetModules();

  const config = await import("../../config.js");
  const vaultMeta = await import("./vaultMeta.js");
  const session = await import("./session.js");
  const totp = await import("./totp.js");
  const { startServer } = await import("../../app.js");

  const server = await startServer(config.HOST, 0);
  const address = server.address() as AddressInfo;
  const baseUrl = `http://${config.HOST}:${address.port}`;

  return {
    vaultDir,
    baseUrl,
    config,
    vaultMeta,
    session,
    totp,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

// High-entropy, not a dictionary word — scores well above MIN_PASSWORD_SCORE.
const STRONG_PASSWORD = randomBytes(32).toString("base64url");

/** Creates a vault (which leaves the session unlocked) and returns the harness. */
async function startUnlockedVault(): Promise<Harness> {
  const harness = await startFreshApp();
  const res = await fetch(`${harness.baseUrl}/api/vault/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      masterPassword: STRONG_PASSWORD,
      noRecoveryAcknowledged: true,
    }),
  });
  expect(res.status).toBe(201);
  return harness;
}

describe("totp.ts", () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    if (harness) {
      try {
        harness.session.lock();
      } catch {
        // best-effort — some tests never touch the session directly
      }
      await harness.close();
      harness = undefined;
    }
    delete process.env.VAULT_DIR;
  });

  it(
    "confirms enrollment with a code generated for the enrolled secret, and returns ten backup codes",
    async () => {
      harness = await startUnlockedVault();

      const enrollment = await harness.totp.beginEnrollment();
      expect(enrollment.qrDataUrl.startsWith("data:image/")).toBe(true);
      expect(enrollment.secret.length).toBeGreaterThan(0);

      const code = await generate({ secret: enrollment.secret });
      const result = await harness.totp.confirmEnrollment(enrollment.enrollmentId, code);

      expect(result).not.toBeNull();
      expect(result?.backupCodes).toHaveLength(10);
      expect(new Set(result?.backupCodes).size).toBe(10);

      const meta = harness.vaultMeta.readVaultMeta();
      expect(meta.totp.enabled).toBe(true);
      expect(meta.totp.wrappedSecret).not.toBeNull();
      expect(meta.totp.backupCodeHashes).toHaveLength(10);
    },
    20000
  );

  it(
    "rejects confirmation with a code generated from a different secret — proving .valid is read explicitly",
    async () => {
      harness = await startUnlockedVault();

      const enrollment = await harness.totp.beginEnrollment();
      // A code generated from an unrelated secret is a syntactically valid
      // six-digit string and therefore a truthy VerifyResult object either
      // way — only reading `.valid` explicitly distinguishes it from a
      // genuine match against the enrolled secret.
      const unrelatedSecret = generateSecret();
      const wrongCode = await generate({ secret: unrelatedSecret });

      const result = await harness.totp.confirmEnrollment(enrollment.enrollmentId, wrongCode);
      expect(result).toBeNull();

      const meta = harness.vaultMeta.readVaultMeta();
      expect(meta.totp.enabled).toBe(false);
      expect(meta.totp.wrappedSecret).toBeNull();
    },
    20000
  );

  it("generateBackupCodes returns ten distinct codes whose SHA-256 digests match the returned hashes", async () => {
    harness = await startUnlockedVault();

    const { codes, hashes } = harness.totp.generateBackupCodes();

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(hashes).toHaveLength(10);

    codes.forEach((code, index) => {
      const expectedHash = createHash("sha256").update(code).digest("hex");
      expect(hashes[index]).toBe(expectedHash);
    });
  });

  it(
    "verifySecondFactor accepts a backup code once and rejects it on reuse, and the sidecar loses exactly one hash",
    async () => {
      harness = await startUnlockedVault();

      const enrollment = await harness.totp.beginEnrollment();
      const code = await generate({ secret: enrollment.secret });
      const enrollResult = await harness.totp.confirmEnrollment(enrollment.enrollmentId, code);
      expect(enrollResult).not.toBeNull();
      const backupCode = enrollResult?.backupCodes[0] as string;

      const vaultKey = harness.session.getVaultKey();
      const metaBefore = harness.vaultMeta.readVaultMeta();
      expect(metaBefore.totp.backupCodeHashes).toHaveLength(10);

      const firstUse = await harness.totp.verifySecondFactor(backupCode, vaultKey, metaBefore);
      expect(firstUse).toBe(true);

      const metaAfter = harness.vaultMeta.readVaultMeta();
      expect(metaAfter.totp.backupCodeHashes).toHaveLength(9);

      const secondUse = await harness.totp.verifySecondFactor(backupCode, vaultKey, metaAfter);
      expect(secondUse).toBe(false);
    },
    20000
  );

  it(
    "verifySecondFactor re-reads the sidecar rather than the caller's stale meta snapshot, so a concurrent regeneration is never silently reverted (WR-06)",
    async () => {
      harness = await startUnlockedVault();

      const enrollment = await harness.totp.beginEnrollment();
      const code = await generate({ secret: enrollment.secret });
      const enrollResult = await harness.totp.confirmEnrollment(enrollment.enrollmentId, code);
      expect(enrollResult).not.toBeNull();

      const vaultKey = harness.session.getVaultKey();

      // Snapshot `meta` the way the /unlock handler does: read once, before
      // whatever real await gap (Argon2id derivation, the live-code check)
      // separates that read from the eventual match-and-write below.
      const staleMeta = harness.vaultMeta.readVaultMeta();

      // Simulate a concurrent request regenerating backup codes during that
      // gap — replaces the whole set with ten brand-new hashes.
      const { hashes: regeneratedHashes } = harness.totp.generateBackupCodes();
      const metaBeforeRegenerate = harness.vaultMeta.readVaultMeta();
      harness.vaultMeta.writeVaultMetaAtomic({
        ...metaBeforeRegenerate,
        totp: { ...metaBeforeRegenerate.totp, backupCodeHashes: regeneratedHashes },
      });

      // A code from the now-superseded (pre-regeneration) set must no
      // longer verify — if this used the stale `meta` argument to build its
      // write, it would find a match against the old hashes, "succeed", and
      // overwrite the sidecar with (old hashes minus one), silently
      // discarding the concurrent regeneration entirely.
      const staleBackupCode = enrollResult?.backupCodes[0] as string;
      const staleResult = await harness.totp.verifySecondFactor(
        staleBackupCode,
        vaultKey,
        staleMeta
      );
      expect(staleResult).toBe(false);

      const metaAfter = harness.vaultMeta.readVaultMeta();
      expect(metaAfter.totp.backupCodeHashes).toEqual(regeneratedHashes);
    },
    20000
  );

  it(
    "the sidecar's raw bytes never contain the base32 secret, in text or base64 form, after a confirmed enrollment",
    async () => {
      harness = await startUnlockedVault();

      const enrollment = await harness.totp.beginEnrollment();
      const code = await generate({ secret: enrollment.secret });
      const result = await harness.totp.confirmEnrollment(enrollment.enrollmentId, code);
      expect(result).not.toBeNull();

      const raw = readFileSync(harness.config.VAULT_META_PATH, "utf-8");
      expect(raw.includes(enrollment.secret)).toBe(false);
      expect(
        raw.includes(Buffer.from(enrollment.secret, "utf-8").toString("base64"))
      ).toBe(false);
    },
    20000
  );
});
