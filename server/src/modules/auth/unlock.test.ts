/**
 * Proves the returning-user unlock path is real: the correct master
 * password unlocks, a wrong one is rejected without corrupting state, and
 * every failure — wrong password, corrupted ciphertext, exceeding the rate
 * limit — produces the byte-identical generic response. Each test gets a
 * fresh temp `VAULT_DIR` and a fresh module registry, mirroring
 * vault-init.test.ts's harness.
 */

import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

interface Harness {
  vaultDir: string;
  baseUrl: string;
  config: typeof import("../../config.js");
  vaultMeta: typeof import("./vaultMeta.js");
  session: typeof import("./session.js");
  close: () => Promise<void>;
}

async function startFreshApp(): Promise<Harness> {
  const vaultDir = path.join(
    os.tmpdir(),
    `vault-unlock-test-${randomBytes(8).toString("hex")}`
  );
  process.env.VAULT_DIR = vaultDir;
  vi.resetModules();

  const config = await import("../../config.js");
  const vaultMeta = await import("./vaultMeta.js");
  const session = await import("./session.js");
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
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function postInit(baseUrl: string, masterPassword: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ masterPassword, noRecoveryAcknowledged: true }),
  });
}

function postUnlock(baseUrl: string, masterPassword: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ masterPassword }),
  });
}

function postLock(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/lock`, { method: "POST" });
}

function getStatus(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/status`);
}

// High-entropy, not a dictionary word — scores well above MIN_PASSWORD_SCORE.
const STRONG_PASSWORD = randomBytes(32).toString("base64url");
const WRONG_PASSWORD = randomBytes(32).toString("base64url");

describe("POST /api/vault/unlock", () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    if (harness) {
      try {
        harness.session.lock();
      } catch {
        // best effort — some tests never unlock a session
      }
      await harness.close();
      harness = undefined;
    }
    delete process.env.VAULT_DIR;
  });

  it(
    "unlocks with the correct password after the vault has been locked",
    async () => {
      harness = await startFreshApp();
      const { baseUrl, config } = harness;

      const initRes = await postInit(baseUrl, STRONG_PASSWORD);
      expect(initRes.status).toBe(201);

      const lockRes = await postLock(baseUrl);
      expect(lockRes.status).toBe(204);

      const lockedStatus = (await (await getStatus(baseUrl)).json()) as {
        unlocked: boolean;
      };
      expect(lockedStatus.unlocked).toBe(false);

      const unlockRes = await postUnlock(baseUrl, STRONG_PASSWORD);
      expect(unlockRes.status).toBe(200);
      const body: unknown = await unlockRes.json();
      expect(body).toEqual({
        initialized: true,
        unlocked: true,
        totpEnabled: false,
        idleTimeoutMs: config.IDLE_TIMEOUT_MS,
      });
    },
    20000
  );

  it(
    "rejects a wrong password without unlocking, and a subsequent correct attempt still succeeds",
    async () => {
      harness = await startFreshApp();
      const { baseUrl } = harness;

      const initRes = await postInit(baseUrl, STRONG_PASSWORD);
      expect(initRes.status).toBe(201);
      await postLock(baseUrl);

      const wrongRes = await postUnlock(baseUrl, WRONG_PASSWORD);
      expect(wrongRes.status).toBe(401);
      const wrongBody: unknown = await wrongRes.json();
      expect(wrongBody).toEqual({ error: "Unable to unlock" });

      const stillLocked = (await (await getStatus(baseUrl)).json()) as {
        unlocked: boolean;
      };
      expect(stillLocked.unlocked).toBe(false);

      // A failed attempt must not corrupt state — the correct password
      // still works afterwards.
      const correctRes = await postUnlock(baseUrl, STRONG_PASSWORD);
      expect(correctRes.status).toBe(200);
    },
    20000
  );

  it(
    "produces a byte-identical response for a wrong password and a corrupted wrappedVaultKey ciphertext",
    async () => {
      harness = await startFreshApp();
      const { baseUrl, vaultMeta } = harness;

      const initRes = await postInit(baseUrl, STRONG_PASSWORD);
      expect(initRes.status).toBe(201);
      await postLock(baseUrl);

      const badPasswordRes = await postUnlock(baseUrl, WRONG_PASSWORD);
      const badPasswordBody: unknown = await badPasswordRes.json();

      // Corrupt the stored ciphertext (flip a character) so unwrapKey's
      // auth-tag check fails even against the *correct* password — this
      // must look identical to a simple wrong-password failure.
      const meta = vaultMeta.readVaultMeta();
      const originalCiphertext = meta.wrappedVaultKey.ciphertextB64;
      const corruptedChar = originalCiphertext[0] === "A" ? "B" : "A";
      meta.wrappedVaultKey.ciphertextB64 =
        corruptedChar + originalCiphertext.slice(1);
      vaultMeta.writeVaultMetaAtomic(meta);

      const corruptedRes = await postUnlock(baseUrl, STRONG_PASSWORD);
      const corruptedBody: unknown = await corruptedRes.json();

      expect(corruptedRes.status).toBe(badPasswordRes.status);
      expect(corruptedBody).toEqual(badPasswordBody);
      expect(corruptedBody).toEqual({ error: "Unable to unlock" });
    },
    20000
  );

  it("returns 409 when no vault exists", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const res = await postUnlock(baseUrl, STRONG_PASSWORD);
    expect(res.status).toBe(409);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: "Vault does not exist" });
  });

  it(
    "throttles repeated unlock attempts with a response matching the generic failure body",
    async () => {
      harness = await startFreshApp();
      const { baseUrl } = harness;

      const initRes = await postInit(baseUrl, STRONG_PASSWORD);
      expect(initRes.status).toBe(201);
      await postLock(baseUrl);

      // Exceed the unlock route's rate-limit ceiling with wrong-password
      // attempts; the response beyond the limit must carry the same
      // generic body as an ordinary wrong-password failure, never a
      // distinct "too many attempts" message.
      let lastRes: Response | undefined;
      for (let i = 0; i < 15; i++) {
        lastRes = await postUnlock(baseUrl, WRONG_PASSWORD);
      }

      expect(lastRes).toBeDefined();
      expect(lastRes?.status).toBe(401);
      const body: unknown = await lastRes?.json();
      expect(body).toEqual({ error: "Unable to unlock" });
    },
    20000
  );
});
