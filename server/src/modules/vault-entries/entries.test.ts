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

function postLock(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/lock`, { method: "POST" });
}

function postUnlock(baseUrl: string, masterPassword: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ masterPassword }),
  });
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

  it("rejects every /api/vault/entries request while the vault is locked", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const initRes = await postInit(baseUrl, STRONG_PASSWORD);
    expect(initRes.status).toBe(201);

    const lockRes = await postLock(baseUrl);
    expect(lockRes.status).toBe(204);

    const getRes = await getEntries(baseUrl);
    expect(getRes.status).toBe(401);
    expect(await getRes.json()).toEqual({ error: "Vault is locked" });

    const postRes = await postEntry(baseUrl, API_KEY_ENTRY);
    expect(postRes.status).toBe(401);
    expect(await postRes.json()).toEqual({ error: "Vault is locked" });
  });

  it("rejects a payload shape mismatched to its declared type, and writes nothing", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const initRes = await postInit(baseUrl, STRONG_PASSWORD);
    expect(initRes.status).toBe(201);

    const invalidRes = await postEntry(baseUrl, {
      type: "api_key",
      name: "Bad entry",
      // login-shaped payload on a declared api_key entry
      payload: { username: "someone", password: "secret" },
    });
    expect(invalidRes.status).toBe(400);
    expect(await invalidRes.json()).toEqual({ error: "Invalid request" });

    const listRes = await getEntries(baseUrl);
    const list = (await listRes.json()) as unknown[];
    expect(list).toHaveLength(0);
  });

  it("creating the same entry twice produces two distinct rows", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const initRes = await postInit(baseUrl, STRONG_PASSWORD);
    expect(initRes.status).toBe(201);

    const firstRes = await postEntry(baseUrl, API_KEY_ENTRY);
    const secondRes = await postEntry(baseUrl, API_KEY_ENTRY);
    expect(firstRes.status).toBe(201);
    expect(secondRes.status).toBe(201);

    const first = (await firstRes.json()) as { id: string };
    const second = (await secondRes.json()) as { id: string };
    expect(first.id).not.toBe(second.id);

    const listRes = await getEntries(baseUrl);
    const list = (await listRes.json()) as unknown[];
    expect(list).toHaveLength(2);
  });

  it("ten concurrent creates all persist", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const initRes = await postInit(baseUrl, STRONG_PASSWORD);
    expect(initRes.status).toBe(201);

    const creates = Array.from({ length: 10 }, (_, i) =>
      postEntry(baseUrl, { ...API_KEY_ENTRY, name: `${API_KEY_ENTRY.name} ${i}` })
    );
    const responses = await Promise.all(creates);
    for (const res of responses) {
      expect(res.status).toBe(201);
    }

    const listRes = await getEntries(baseUrl);
    const list = (await listRes.json()) as unknown[];
    expect(list).toHaveLength(10);
  });

  it("round-trips unicode (emoji, CJK, combining diacritic) byte-identical", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const initRes = await postInit(baseUrl, STRONG_PASSWORD);
    expect(initRes.status).toBe(201);

    const unicodeName = "🔑 备忘录 é"; // emoji, CJK, "e" + combining acute accent
    const createRes = await postEntry(baseUrl, {
      type: "note",
      name: unicodeName,
      payload: { body: "recovery codes: 🔒 你好 é" },
    });
    expect(createRes.status).toBe(201);

    const listRes = await getEntries(baseUrl);
    const list = (await listRes.json()) as Array<{ name: string }>;
    expect(list.some((e) => e.name === unicodeName)).toBe(true);
  });

  it("accepts an empty note body as valid, not a 400", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const initRes = await postInit(baseUrl, STRONG_PASSWORD);
    expect(initRes.status).toBe(201);

    const createRes = await postEntry(baseUrl, {
      type: "note",
      name: "Blank note",
      payload: { body: "" },
    });
    expect(createRes.status).toBe(201);
  });

  it("list responses never carry a payload or notes property", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const initRes = await postInit(baseUrl, STRONG_PASSWORD);
    expect(initRes.status).toBe(201);

    const createRes = await postEntry(baseUrl, {
      ...API_KEY_ENTRY,
      notes: "sensitive freeform notes",
    });
    expect(createRes.status).toBe(201);

    const listRes = await getEntries(baseUrl);
    const list = (await listRes.json()) as Array<Record<string, unknown>>;
    expect(list.length).toBeGreaterThan(0);
    for (const entry of list) {
      expect(Object.prototype.hasOwnProperty.call(entry, "payload")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(entry, "notes")).toBe(false);
    }
  });

  it("a vault created before this phase gains the entry tables the first time it is unlocked", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const initRes = await postInit(baseUrl, STRONG_PASSWORD);
    expect(initRes.status).toBe(201);

    const lockRes = await postLock(baseUrl);
    expect(lockRes.status).toBe(204);

    const unlockRes = await postUnlock(baseUrl, STRONG_PASSWORD);
    expect(unlockRes.status).toBe(200);

    const listRes = await getEntries(baseUrl);
    expect(listRes.status).toBe(200);
  });

  it("repeated vault opens do not duplicate the schema_version row", async () => {
    harness = await startFreshApp();
    const { baseUrl, session } = harness;

    const initRes = await postInit(baseUrl, STRONG_PASSWORD);
    expect(initRes.status).toBe(201);

    const lockRes = await postLock(baseUrl);
    expect(lockRes.status).toBe(204);

    const unlockRes = await postUnlock(baseUrl, STRONG_PASSWORD);
    expect(unlockRes.status).toBe(200);

    const db = session.getDb();
    const versionRows = await db.selectFrom("schema_version").selectAll().execute();
    expect(versionRows).toHaveLength(1);
  });
});
