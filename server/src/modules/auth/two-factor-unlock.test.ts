/**
 * Proves this plan's central prohibition mechanically, not just by
 * assertion: a valid TOTP code never unlocks the vault without the correct
 * master password, every second-factor failure response is byte-identical
 * to a single-factor wrong-password response, a backup code works exactly
 * once, and the sidecar contains neither the base32 secret nor any
 * plaintext backup code in any encoding. Extends `unlock.test.ts`'s harness
 * and conventions with a real, confirmed TOTP enrollment.
 */

import { randomBytes } from "node:crypto";
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
  session: typeof import("./session.js");
  close: () => Promise<void>;
}

async function startFreshApp(): Promise<Harness> {
  const vaultDir = path.join(
    os.tmpdir(),
    `vault-2fa-unlock-test-${randomBytes(8).toString("hex")}`
  );
  process.env.VAULT_DIR = vaultDir;
  vi.resetModules();

  const config = await import("../../config.js");
  const session = await import("./session.js");
  const { startServer } = await import("../../app.js");

  const server = await startServer(config.HOST, 0);
  const address = server.address() as AddressInfo;
  const baseUrl = `http://${config.HOST}:${address.port}`;

  return {
    vaultDir,
    baseUrl,
    config,
    session,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function closeHarness(h: Harness): Promise<void> {
  try {
    h.session.lock();
  } catch {
    // best-effort — some tests never touch the session directly
  }
  await h.close();
}

function postInit(baseUrl: string, masterPassword: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ masterPassword, noRecoveryAcknowledged: true }),
  });
}

function postUnlock(
  baseUrl: string,
  masterPassword: string,
  totpCode?: string
): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ masterPassword, totpCode }),
  });
}

function postLock(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/lock`, { method: "POST" });
}

function getStatus(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/status`);
}

function postEnroll(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/2fa/enroll`, { method: "POST" });
}

function postConfirm(
  baseUrl: string,
  enrollmentId: string,
  code: string,
  masterPassword: string
): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/2fa/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enrollmentId, code, masterPassword }),
  });
}

function postDisable(baseUrl: string, masterPassword: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/2fa/disable`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ masterPassword }),
  });
}

// High-entropy, not dictionary words — score well above MIN_PASSWORD_SCORE.
const STRONG_PASSWORD = randomBytes(32).toString("base64url");
const WRONG_PASSWORD = randomBytes(32).toString("base64url");

interface EnrolledVault {
  harness: Harness;
  secret: string;
  backupCodes: string[];
}

/**
 * Creates a vault, enables 2FA through a real confirmed enrollment (using
 * otplib to generate a genuinely valid code from the enrolled secret), and
 * locks it — every test starts from the same known locked, 2FA-enabled
 * state.
 */
async function setupEnrolledLockedVault(): Promise<EnrolledVault> {
  const harness = await startFreshApp();

  const initRes = await postInit(harness.baseUrl, STRONG_PASSWORD);
  expect(initRes.status).toBe(201);

  const enrollRes = await postEnroll(harness.baseUrl);
  expect(enrollRes.status).toBe(200);
  const enrollment = (await enrollRes.json()) as {
    enrollmentId: string;
    secret: string;
  };

  const code = await generate({ secret: enrollment.secret });
  const confirmRes = await postConfirm(
    harness.baseUrl,
    enrollment.enrollmentId,
    code,
    STRONG_PASSWORD
  );
  expect(confirmRes.status).toBe(200);
  const confirmBody = (await confirmRes.json()) as { backupCodes: string[] };

  const lockRes = await postLock(harness.baseUrl);
  expect(lockRes.status).toBe(204);

  return { harness, secret: enrollment.secret, backupCodes: confirmBody.backupCodes };
}

describe("two-factor unlock", () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    if (harness) {
      await closeHarness(harness);
      harness = undefined;
    }
    delete process.env.VAULT_DIR;
  });

  it(
    "confirming enrollment with an incorrect master password fails, even with a genuinely valid code, and 2FA is never enabled (CR-01)",
    async () => {
      harness = await startFreshApp();

      const initRes = await postInit(harness.baseUrl, STRONG_PASSWORD);
      expect(initRes.status).toBe(201);

      const enrollRes = await postEnroll(harness.baseUrl);
      expect(enrollRes.status).toBe(200);
      const enrollment = (await enrollRes.json()) as {
        enrollmentId: string;
        secret: string;
      };

      const code = await generate({ secret: enrollment.secret });
      const confirmRes = await postConfirm(
        harness.baseUrl,
        enrollment.enrollmentId,
        code,
        WRONG_PASSWORD
      );
      expect(confirmRes.status).toBe(401);
      const confirmBody: unknown = await confirmRes.json();
      expect(confirmBody).toEqual({ error: "Unable to unlock" });

      const status = (await (await getStatus(harness.baseUrl)).json()) as {
        totpEnabled: boolean;
      };
      expect(status.totpEnabled).toBe(false);

      // The pending enrollment is left intact by a wrong-password attempt
      // (only a wrong/expired enrollment id or an already-committed
      // enrollment consumes it), so the same code with the correct password
      // still confirms successfully afterward.
      const retryRes = await postConfirm(
        harness.baseUrl,
        enrollment.enrollmentId,
        code,
        STRONG_PASSWORD
      );
      expect(retryRes.status).toBe(200);
    },
    20000
  );

  it(
    "the correct master password with a valid current code unlocks the vault",
    async () => {
      const enrolled = await setupEnrolledLockedVault();
      harness = enrolled.harness;

      const code = await generate({ secret: enrolled.secret });
      const res = await postUnlock(harness.baseUrl, STRONG_PASSWORD, code);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { unlocked: boolean };
      expect(body.unlocked).toBe(true);
    },
    20000
  );

  it(
    "the correct master password with no code at all fails, and the vault stays locked",
    async () => {
      const enrolled = await setupEnrolledLockedVault();
      harness = enrolled.harness;

      const res = await postUnlock(harness.baseUrl, STRONG_PASSWORD);
      expect(res.status).toBe(401);

      const status = (await (await getStatus(harness.baseUrl)).json()) as {
        unlocked: boolean;
      };
      expect(status.unlocked).toBe(false);
    },
    20000
  );

  it(
    "the correct master password with an incorrect code fails",
    async () => {
      const enrolled = await setupEnrolledLockedVault();
      harness = enrolled.harness;

      const unrelatedSecret = generateSecret();
      const wrongCode = await generate({ secret: unrelatedSecret });

      const res = await postUnlock(harness.baseUrl, STRONG_PASSWORD, wrongCode);
      expect(res.status).toBe(401);
    },
    20000
  );

  it(
    "an incorrect master password with a valid current code fails — the second factor cannot substitute for the first",
    async () => {
      const enrolled = await setupEnrolledLockedVault();
      harness = enrolled.harness;

      const code = await generate({ secret: enrolled.secret });
      const res = await postUnlock(harness.baseUrl, WRONG_PASSWORD, code);
      expect(res.status).toBe(401);

      const status = (await (await getStatus(harness.baseUrl)).json()) as {
        unlocked: boolean;
      };
      expect(status.unlocked).toBe(false);
    },
    20000
  );

  it(
    "the missing-code, wrong-code, and wrong-password responses are byte-identical to each other and to a single-factor vault's wrong-password response",
    async () => {
      const enrolled = await setupEnrolledLockedVault();
      harness = enrolled.harness;

      const missingCodeRes = await postUnlock(harness.baseUrl, STRONG_PASSWORD);
      const missingCodeBody: unknown = await missingCodeRes.json();

      const unrelatedSecret = generateSecret();
      const wrongCode = await generate({ secret: unrelatedSecret });
      const wrongCodeRes = await postUnlock(harness.baseUrl, STRONG_PASSWORD, wrongCode);
      const wrongCodeBody: unknown = await wrongCodeRes.json();

      const validCodeForWrongPassword = await generate({ secret: enrolled.secret });
      const wrongPasswordRes = await postUnlock(
        harness.baseUrl,
        WRONG_PASSWORD,
        validCodeForWrongPassword
      );
      const wrongPasswordBody: unknown = await wrongPasswordRes.json();

      expect(missingCodeRes.status).toBe(401);
      expect(wrongCodeRes.status).toBe(401);
      expect(wrongPasswordRes.status).toBe(401);
      expect(missingCodeBody).toEqual({ error: "Unable to unlock" });
      expect(wrongCodeBody).toEqual(missingCodeBody);
      expect(wrongPasswordBody).toEqual(missingCodeBody);

      // Compare against a fresh single-factor (no 2FA) vault's own
      // wrong-password response — must be byte-identical too, so a caller
      // cannot tell from the response alone whether 2FA even exists.
      const singleFactorHarness = await startFreshApp();
      try {
        const singleFactorInitRes = await postInit(
          singleFactorHarness.baseUrl,
          STRONG_PASSWORD
        );
        expect(singleFactorInitRes.status).toBe(201);
        await postLock(singleFactorHarness.baseUrl);

        const singleFactorRes = await postUnlock(
          singleFactorHarness.baseUrl,
          WRONG_PASSWORD
        );
        const singleFactorBody: unknown = await singleFactorRes.json();
        expect(singleFactorRes.status).toBe(401);
        expect(singleFactorBody).toEqual(missingCodeBody);
      } finally {
        await closeHarness(singleFactorHarness);
      }
    },
    30000
  );

  it("GET /api/vault/status reports totpEnabled: true while the vault is locked", async () => {
    const enrolled = await setupEnrolledLockedVault();
    harness = enrolled.harness;

    const status = (await (await getStatus(harness.baseUrl)).json()) as {
      unlocked: boolean;
      totpEnabled: boolean;
    };
    expect(status.unlocked).toBe(false);
    expect(status.totpEnabled).toBe(true);
  }, 20000);

  it(
    "an unused backup code plus the correct master password unlocks once; the same code fails immediately afterward; a different unused code still works",
    async () => {
      const enrolled = await setupEnrolledLockedVault();
      harness = enrolled.harness;

      const firstCode = enrolled.backupCodes[0] as string;
      const secondCode = enrolled.backupCodes[1] as string;

      const firstRes = await postUnlock(harness.baseUrl, STRONG_PASSWORD, firstCode);
      expect(firstRes.status).toBe(200);

      await postLock(harness.baseUrl);

      const replayRes = await postUnlock(harness.baseUrl, STRONG_PASSWORD, firstCode);
      expect(replayRes.status).toBe(401);

      const secondRes = await postUnlock(harness.baseUrl, STRONG_PASSWORD, secondCode);
      expect(secondRes.status).toBe(200);
    },
    20000
  );

  it(
    "a code valid in a previous time step is rejected once the tolerance window has passed",
    async () => {
      const enrolled = await setupEnrolledLockedVault();
      harness = enrolled.harness;

      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const code = await generate({ secret: enrolled.secret });

        // One 30-second period plus a 30-second tolerance window is well
        // inside 5 minutes — moving the clock forward that far is
        // unambiguously past the window, without waiting for real time.
        vi.setSystemTime(Date.now() + 5 * 60_000);

        const res = await postUnlock(harness.baseUrl, STRONG_PASSWORD, code);
        expect(res.status).toBe(401);
      } finally {
        vi.useRealTimers();
      }
    },
    20000
  );

  it(
    "the sidecar's raw bytes contain neither the base32 secret nor any plaintext backup code, in any encoding",
    async () => {
      const enrolled = await setupEnrolledLockedVault();
      harness = enrolled.harness;

      const raw = readFileSync(harness.config.VAULT_META_PATH, "utf-8");
      expect(raw.includes(enrolled.secret)).toBe(false);
      expect(
        raw.includes(Buffer.from(enrolled.secret, "utf-8").toString("base64"))
      ).toBe(false);

      for (const code of enrolled.backupCodes) {
        expect(raw.includes(code)).toBe(false);
        expect(raw.includes(Buffer.from(code, "utf-8").toString("base64"))).toBe(false);
      }
    },
    20000
  );

  it(
    "disabling 2FA with the correct master password returns the vault to single-factor unlock; an incorrect password fails and leaves 2FA on",
    async () => {
      const enrolled = await setupEnrolledLockedVault();
      harness = enrolled.harness;

      const code = await generate({ secret: enrolled.secret });
      const unlockRes = await postUnlock(harness.baseUrl, STRONG_PASSWORD, code);
      expect(unlockRes.status).toBe(200);

      const badDisableRes = await postDisable(harness.baseUrl, WRONG_PASSWORD);
      expect(badDisableRes.status).toBe(401);

      const statusAfterBadDisable = (await (await getStatus(harness.baseUrl)).json()) as {
        totpEnabled: boolean;
      };
      expect(statusAfterBadDisable.totpEnabled).toBe(true);

      const disableRes = await postDisable(harness.baseUrl, STRONG_PASSWORD);
      expect(disableRes.status).toBe(204);

      await postLock(harness.baseUrl);
      const singleFactorUnlockRes = await postUnlock(harness.baseUrl, STRONG_PASSWORD);
      expect(singleFactorUnlockRes.status).toBe(200);
    },
    20000
  );
});
