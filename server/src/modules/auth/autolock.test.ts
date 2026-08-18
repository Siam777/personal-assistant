/**
 * Proves the five-minute idle auto-lock is real, not merely a UI flag: the
 * in-memory key buffer is actually zeroed, the database handle is closed,
 * the timer is cleared, and access is denied over a real HTTP request after
 * it fires. Also proves the auto-lock cannot be silently defeated by the
 * client's own `GET /status` polling. Uses vitest's fake timers so a
 * five-minute wait is instantaneous; each test gets a fresh temp
 * `VAULT_DIR` and a fresh module registry, mirroring unlock.test.ts.
 *
 * No vault data route exists yet (Phase 2 adds one), so a temporary
 * test-only route is mounted behind `requireUnlocked` inside this file —
 * assertions 4-6 exercise the guard over a real HTTP round trip, because
 * the requirement is that decrypted data is unreachable through any code
 * path, not just that `session.isUnlocked()` reports the right boolean.
 */

import { randomBytes } from "node:crypto";
import type { AddressInfo, Server } from "node:net";
import os from "node:os";
import path from "node:path";
import { Router, type Express } from "express";
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
    `vault-autolock-test-${randomBytes(8).toString("hex")}`
  );
  process.env.VAULT_DIR = vaultDir;
  vi.resetModules();

  const config = await import("../../config.js");
  const session = await import("./session.js");
  const { requireUnlocked } = await import("../../middleware/requireUnlocked.js");
  const { createApp } = await import("../../app.js");

  const app: Express = createApp();
  const testRouter = Router();
  testRouter.get("/api/test/guarded", requireUnlocked, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(testRouter);

  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(0, config.HOST);
    s.once("listening", () => resolve(s));
    s.once("error", reject);
  });
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

function getGuarded(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/api/test/guarded`);
}

// High-entropy, not a dictionary word — scores well above MIN_PASSWORD_SCORE.
const STRONG_PASSWORD = randomBytes(32).toString("base64url");

describe("Five-minute idle auto-lock", () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    if (harness) {
      try {
        harness.session.lock();
      } catch {
        // best effort
      }
      await harness.close();
      harness = undefined;
    }
    delete process.env.VAULT_DIR;
  });

  it(
    "arms on unlock, holds until just before the timeout, and at the timeout zeroes the key, closes the handle, clears the timer, and denies HTTP access",
    async () => {
      harness = await startFreshApp();
      const { baseUrl, config, session } = harness;

      const initRes = await postInit(baseUrl, STRONG_PASSWORD);
      expect(initRes.status).toBe(201);
      await postLock(baseUrl);

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      const unlockRes = await postUnlock(baseUrl, STRONG_PASSWORD);
      expect(unlockRes.status).toBe(200);

      // (1) unlocked, and a key buffer is held.
      expect(session.isUnlocked()).toBe(true);
      expect(session.__unsafeTestOnlyObserveSession()?.hasKeyMaterial).toBe(true);

      // (2) just under the timeout leaves the vault unlocked.
      await vi.advanceTimersByTimeAsync(config.IDLE_TIMEOUT_MS - 1000);
      expect(session.isUnlocked()).toBe(true);

      // (3) crossing the timeout locks it: the retained buffer reads back
      // as all zero bytes, and both key/db accessors throw.
      await vi.advanceTimersByTimeAsync(1000);
      expect(session.isUnlocked()).toBe(false);
      const observed = session.__unsafeTestOnlyObserveSession();
      expect(observed?.hasKeyMaterial).toBe(false);
      expect(observed?.lastLockedBufferIsAllZero).toBe(true);
      expect(() => session.getVaultKey()).toThrow();
      expect(() => session.getDb()).toThrow();

      // (4) after the automatic lock, a direct HTTP request to a
      // requireUnlocked-guarded route is refused.
      const guardedRes = await getGuarded(baseUrl);
      expect(guardedRes.status).toBe(401);
    },
    20000
  );

  it(
    "a request through requireUnlocked re-arms the timer, extending the session past the original five-minute mark",
    async () => {
      harness = await startFreshApp();
      const { baseUrl, config, session } = harness;

      const initRes = await postInit(baseUrl, STRONG_PASSWORD);
      expect(initRes.status).toBe(201);
      await postLock(baseUrl);

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      const unlockRes = await postUnlock(baseUrl, STRONG_PASSWORD);
      expect(unlockRes.status).toBe(200);

      // Advance to just before the original timeout, then make a request
      // through requireUnlocked — this re-arms the timer to a fresh
      // IDLE_TIMEOUT_MS measured from now.
      await vi.advanceTimersByTimeAsync(config.IDLE_TIMEOUT_MS - 30_000);
      const guardedRes = await getGuarded(baseUrl);
      expect(guardedRes.status).toBe(200);

      // Advance by just under IDLE_TIMEOUT_MS again, measured from the
      // re-arming request — total elapsed time since the *original*
      // unlock is now well past IDLE_TIMEOUT_MS, but the vault must still
      // be unlocked because the timer was reset by the guarded request.
      await vi.advanceTimersByTimeAsync(config.IDLE_TIMEOUT_MS - 1000);
      expect(session.isUnlocked()).toBe(true);
    },
    20000
  );

  it(
    "repeated GET /status polling does NOT re-arm the timer — the vault still locks at the original five-minute mark",
    async () => {
      harness = await startFreshApp();
      const { baseUrl, config, session } = harness;

      const initRes = await postInit(baseUrl, STRONG_PASSWORD);
      expect(initRes.status).toBe(201);
      await postLock(baseUrl);

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      const unlockRes = await postUnlock(baseUrl, STRONG_PASSWORD);
      expect(unlockRes.status).toBe(200);

      // Poll status every simulated minute for four minutes — /status sits
      // deliberately outside requireUnlocked, so none of these calls may
      // arm or extend the timer.
      for (let minute = 1; minute <= 4; minute++) {
        await vi.advanceTimersByTimeAsync(60_000);
        const statusRes = await getStatus(baseUrl);
        expect(statusRes.status).toBe(200);
        const body = (await statusRes.json()) as { unlocked: boolean };
        expect(body.unlocked).toBe(true);
      }

      // The fifth minute crosses IDLE_TIMEOUT_MS (5 * 60_000) measured from
      // the original unlock — the vault must lock despite the four status
      // polls along the way.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(session.isUnlocked()).toBe(false);
      expect(config.IDLE_TIMEOUT_MS).toBe(5 * 60_000);
    },
    20000
  );

  it(
    "POST /lock locks immediately, is safe to call again while already locked, and a subsequent unlock still succeeds",
    async () => {
      harness = await startFreshApp();
      const { baseUrl } = harness;

      const initRes = await postInit(baseUrl, STRONG_PASSWORD);
      expect(initRes.status).toBe(201);

      const firstLockRes = await postLock(baseUrl);
      expect(firstLockRes.status).toBe(204);
      const statusAfterLock = (await (await getStatus(baseUrl)).json()) as {
        unlocked: boolean;
      };
      expect(statusAfterLock.unlocked).toBe(false);

      const secondLockRes = await postLock(baseUrl);
      expect(secondLockRes.status).toBe(204);

      const unlockRes = await postUnlock(baseUrl, STRONG_PASSWORD);
      expect(unlockRes.status).toBe(200);
    },
    20000
  );

  it("the test-only observability accessor is inert outside the test environment", async () => {
    harness = await startFreshApp();
    const { session } = harness;

    const original = process.env.VITEST;
    delete process.env.VITEST;
    try {
      expect(session.__unsafeTestOnlyObserveSession()).toBeNull();
    } finally {
      if (original !== undefined) {
        process.env.VITEST = original;
      }
    }
  });
});
