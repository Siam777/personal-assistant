/**
 * Proves the create/list entry path round-trips through a real encrypted
 * vault file. Harness mirrors `auth/unlock.test.ts`'s `startFreshApp`: a
 * fresh temp `VAULT_DIR` and a fresh module registry per test.
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
  session: typeof import("../auth/session.js");
  close: () => Promise<void>;
}

async function startFreshApp(): Promise<Harness> {
  const vaultDir = path.join(
    os.tmpdir(),
    `vault-entries-test-${randomBytes(8).toString("hex")}`
  );
  process.env.VAULT_DIR = vaultDir;
  vi.resetModules();

  const config = await import("../../config.js");
  const session = await import("../auth/session.js");
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

function postInit(baseUrl: string, masterPassword: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ masterPassword, noRecoveryAcknowledged: true }),
  });
}

function postEntry(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getEntries(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/entries`);
}

// High-entropy, not a dictionary word — scores well above MIN_PASSWORD_SCORE.
const STRONG_PASSWORD = randomBytes(32).toString("base64url");

const API_KEY_ENTRY = {
  type: "api_key",
  name: "OpenRouter key",
  payload: { key: "sk-test-123", endpoint: "https://openrouter.ai/api/v1", model: "gpt-4" },
};

describe("POST /api/vault/entries + GET /api/vault/entries", () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    if (harness) {
      try {
        harness.session.lock();
      } catch {
        // already locked/torn down
      }
      await harness.close();
      harness = undefined;
    }
  });

  it("creates an api_key entry and returns it in the list", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const initRes = await postInit(baseUrl, STRONG_PASSWORD);
    expect(initRes.status).toBe(201);

    const createRes = await postEntry(baseUrl, API_KEY_ENTRY);
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; name: string };
    expect(created.id).toBeTruthy();

    const listRes = await getEntries(baseUrl);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{ id: string; name: string }>;
    expect(list.some((e) => e.id === created.id && e.name === API_KEY_ENTRY.name)).toBe(true);
  });
});
