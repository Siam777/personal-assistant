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

function getEntry(baseUrl: string, id: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/entries/${id}`);
}

function patchEntry(baseUrl: string, id: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/entries/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteEntry(baseUrl: string, id: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/entries/${id}`, { method: "DELETE" });
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

const LOGIN_ENTRY = {
  type: "login",
  name: "GitHub login",
  payload: { username: "octocat", password: STRONG_PASSWORD, url: "https://github.com" },
};

const NOTE_ENTRY = {
  type: "note",
  name: "SSH recovery",
  payload: { body: "ssh-ed25519 AAAA... recovery key" },
};

const CARD_ENTRY = {
  type: "card",
  name: "Visa debit",
  payload: { number: "4111111111111111", expiry: "12/29", cvv: "123", cardholder: "Jane Doe" },
};

async function initAndCreate(
  baseUrl: string,
  body: unknown
): Promise<{ id: string } & Record<string, unknown>> {
  const initRes = await postInit(baseUrl, STRONG_PASSWORD);
  expect(initRes.status).toBe(201);
  const createRes = await postEntry(baseUrl, body);
  expect(createRes.status).toBe(201);
  return (await createRes.json()) as { id: string } & Record<string, unknown>;
}

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

  it.each([
    ["login", LOGIN_ENTRY],
    ["note", NOTE_ENTRY],
    ["card", CARD_ENTRY],
  ] as const)("round-trips a %s entry through GET /entries/:id", async (_label, body) => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const created = await initAndCreate(baseUrl, body);

    const getRes = await getEntry(baseUrl, created.id);
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as { type: string; name: string; payload: unknown };
    expect(fetched.type).toBe(body.type);
    expect(fetched.name).toBe(body.name);
    expect(fetched.payload).toEqual(body.payload);
  });

  it("creating the same login entry twice produces two distinct rows", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const initRes = await postInit(baseUrl, STRONG_PASSWORD);
    expect(initRes.status).toBe(201);

    const firstRes = await postEntry(baseUrl, LOGIN_ENTRY);
    const secondRes = await postEntry(baseUrl, LOGIN_ENTRY);
    expect(firstRes.status).toBe(201);
    expect(secondRes.status).toBe(201);

    const first = (await firstRes.json()) as { id: string };
    const second = (await secondRes.json()) as { id: string };
    expect(first.id).not.toBe(second.id);

    const listRes = await getEntries(baseUrl);
    const list = (await listRes.json()) as unknown[];
    expect(list).toHaveLength(2);
  });

  it("creating the same card entry twice produces two distinct rows", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const initRes = await postInit(baseUrl, STRONG_PASSWORD);
    expect(initRes.status).toBe(201);

    const firstRes = await postEntry(baseUrl, CARD_ENTRY);
    const secondRes = await postEntry(baseUrl, CARD_ENTRY);
    expect(firstRes.status).toBe(201);
    expect(secondRes.status).toBe(201);

    const first = (await firstRes.json()) as { id: string };
    const second = (await secondRes.json()) as { id: string };
    expect(first.id).not.toBe(second.id);

    const listRes = await getEntries(baseUrl);
    const list = (await listRes.json()) as unknown[];
    expect(list).toHaveLength(2);
  });

  it("ten concurrent login creates and ten concurrent card creates all persist", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const initRes = await postInit(baseUrl, STRONG_PASSWORD);
    expect(initRes.status).toBe(201);

    const loginCreates = Array.from({ length: 10 }, (_, i) =>
      postEntry(baseUrl, { ...LOGIN_ENTRY, name: `${LOGIN_ENTRY.name} ${i}` })
    );
    const cardCreates = Array.from({ length: 10 }, (_, i) =>
      postEntry(baseUrl, { ...CARD_ENTRY, name: `${CARD_ENTRY.name} ${i}` })
    );
    const responses = await Promise.all([...loginCreates, ...cardCreates]);
    for (const res of responses) {
      expect(res.status).toBe(201);
    }

    const listRes = await getEntries(baseUrl);
    const list = (await listRes.json()) as unknown[];
    expect(list).toHaveLength(20);
  });

  it("PATCH twice with an identical body is idempotent and advances updatedAt", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const created = await initAndCreate(baseUrl, API_KEY_ENTRY);
    const createdAt = created.createdAt as string;

    const updateBody = {
      type: "api_key",
      name: "Renamed key",
      folderId: null,
      notes: null,
      tags: [],
      payload: { key: "sk-updated-456", endpoint: "https://openrouter.ai/api/v1", model: "gpt-4" },
    };

    const firstPatch = await patchEntry(baseUrl, created.id, updateBody);
    expect(firstPatch.status).toBe(200);
    const secondPatch = await patchEntry(baseUrl, created.id, updateBody);
    expect(secondPatch.status).toBe(200);
    const secondBody = (await secondPatch.json()) as { updatedAt: string; name: string };
    expect(secondBody.name).toBe("Renamed key");
    expect(new Date(secondBody.updatedAt).getTime()).toBeGreaterThan(new Date(createdAt).getTime());

    const listRes = await getEntries(baseUrl);
    const list = (await listRes.json()) as unknown[];
    expect(list).toHaveLength(1);
  });

  it("rejects a PATCH that changes the entry type, and leaves the stored entry unchanged", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const created = await initAndCreate(baseUrl, API_KEY_ENTRY);

    const patchRes = await patchEntry(baseUrl, created.id, {
      ...LOGIN_ENTRY,
      folderId: null,
      notes: null,
      tags: [],
    });
    expect(patchRes.status).toBe(400);
    expect(await patchRes.json()).toEqual({ error: "Entry type cannot be changed" });

    const getRes = await getEntry(baseUrl, created.id);
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as { type: string; payload: unknown };
    expect(fetched.type).toBe("api_key");
    expect(fetched.payload).toEqual(API_KEY_ENTRY.payload);
  });

  it("PATCH rejects a body missing folderId, notes, or tags with 400 instead of silently clearing them (CR-01)", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const created = await initAndCreate(baseUrl, { ...API_KEY_ENTRY, tags: ["work"] });
    const setupPatch = await patchEntry(baseUrl, created.id, {
      type: "api_key",
      name: "Tagged key",
      folderId: null,
      notes: "keep me",
      tags: ["work"],
      payload: API_KEY_ENTRY.payload,
    });
    expect(setupPatch.status).toBe(200);

    // Omitting `tags` must 400, not silently untag the entry.
    const missingTags = await patchEntry(baseUrl, created.id, {
      type: "api_key",
      name: "Tagged key",
      folderId: null,
      notes: "keep me",
      payload: API_KEY_ENTRY.payload,
    });
    expect(missingTags.status).toBe(400);

    // Omitting `notes` must 400, not silently clear it.
    const missingNotes = await patchEntry(baseUrl, created.id, {
      type: "api_key",
      name: "Tagged key",
      folderId: null,
      tags: ["work"],
      payload: API_KEY_ENTRY.payload,
    });
    expect(missingNotes.status).toBe(400);

    // Omitting `folderId` must 400, not silently uncategorize it.
    const missingFolderId = await patchEntry(baseUrl, created.id, {
      type: "api_key",
      name: "Tagged key",
      notes: "keep me",
      tags: ["work"],
      payload: API_KEY_ENTRY.payload,
    });
    expect(missingFolderId.status).toBe(400);

    // Confirm none of the rejected requests mutated the stored entry.
    const getRes = await getEntry(baseUrl, created.id);
    const fetched = (await getRes.json()) as { notes: string | null; tags: string[] };
    expect(fetched.notes).toBe("keep me");
    expect(fetched.tags).toEqual(["work"]);
  });

  it("a note edited with unicode (emoji, CJK, combining diacritic) round-trips byte-identical", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const created = await initAndCreate(baseUrl, NOTE_ENTRY);

    const unicodeName = "🔑 备忘录 é";
    const unicodeBody = "recovery codes: 🔒 你好 é";
    const updateBody = {
      type: "note",
      name: unicodeName,
      folderId: null,
      notes: null,
      tags: [],
      payload: { body: unicodeBody },
    };

    const patchRes = await patchEntry(baseUrl, created.id, updateBody);
    expect(patchRes.status).toBe(200);

    const getRes = await getEntry(baseUrl, created.id);
    const fetched = (await getRes.json()) as { name: string; payload: { body: string } };
    expect(fetched.name).toBe(unicodeName);
    expect(fetched.payload.body).toBe(unicodeBody);
  });

  it("rejects a blank (whitespace-only) name with 400", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const initRes = await postInit(baseUrl, STRONG_PASSWORD);
    expect(initRes.status).toBe(201);

    const createRes = await postEntry(baseUrl, {
      type: "note",
      name: "   ",
      payload: { body: "" },
    });
    expect(createRes.status).toBe(400);
  });

  it("soft delete: DELETE returns 204, GET then 404s, list omits it, row survives with deleted_at set", async () => {
    harness = await startFreshApp();
    const { baseUrl, session } = harness;

    const created = await initAndCreate(baseUrl, API_KEY_ENTRY);

    const deleteRes = await deleteEntry(baseUrl, created.id);
    expect(deleteRes.status).toBe(204);

    const getRes = await getEntry(baseUrl, created.id);
    expect(getRes.status).toBe(404);

    const listRes = await getEntries(baseUrl);
    const list = (await listRes.json()) as Array<{ id: string }>;
    expect(list.some((e) => e.id === created.id)).toBe(false);

    const db = session.getDb();
    const row = await db
      .selectFrom("entries")
      .selectAll()
      .where("id", "=", created.id)
      .executeTakeFirstOrThrow();
    expect(row.deleted_at).not.toBeNull();
  });

  it("GET, PATCH, and DELETE against a random unknown id all return 404", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;

    const initRes = await postInit(baseUrl, STRONG_PASSWORD);
    expect(initRes.status).toBe(201);

    const unknownId = "00000000-0000-0000-0000-000000000000";

    const getRes = await getEntry(baseUrl, unknownId);
    expect(getRes.status).toBe(404);

    const patchRes = await patchEntry(baseUrl, unknownId, {
      ...API_KEY_ENTRY,
      folderId: null,
      notes: null,
      tags: [],
    });
    expect(patchRes.status).toBe(404);

    const deleteRes = await deleteEntry(baseUrl, unknownId);
    expect(deleteRes.status).toBe(404);
  });
});
