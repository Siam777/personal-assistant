/**
 * Proves the trash safety net end to end through a real encrypted vault:
 * restore, permanent delete, empty trash, and the automatic retention
 * purge on vault open. Harness mirrors `entries.test.ts`/`organization.test.ts`'s
 * `startFreshApp`: a fresh temp `VAULT_DIR` and a fresh module registry per
 * test.
 */

import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

interface Harness {
  vaultDir: string;
  baseUrl: string;
  session: typeof import("../auth/session.js");
  close: () => Promise<void>;
}

async function startFreshApp(): Promise<Harness> {
  const vaultDir = path.join(os.tmpdir(), `vault-trash-test-${randomBytes(8).toString("hex")}`);
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
    session,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

// High-entropy, not a dictionary word — scores well above MIN_PASSWORD_SCORE.
const STRONG_PASSWORD = randomBytes(32).toString("base64url");

function postInit(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ masterPassword: STRONG_PASSWORD, noRecoveryAcknowledged: true }),
  });
}

function postUnlock(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ masterPassword: STRONG_PASSWORD }),
  });
}

function postLock(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/lock`, { method: "POST" });
}

function postEntry(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getEntriesFiltered(baseUrl: string, params?: Record<string, string>): Promise<Response> {
  const url = new URL("/api/vault/entries", baseUrl);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return fetch(url);
}

function deleteEntrySoft(baseUrl: string, id: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/entries/${id}`, { method: "DELETE" });
}

function postRestore(baseUrl: string, id: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/entries/${id}/restore`, { method: "POST" });
}

function deletePermanent(baseUrl: string, id: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/entries/${id}/permanent`, { method: "DELETE" });
}

function postEmptyTrash(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/entries/trash/empty`, { method: "POST" });
}

function postFolder(baseUrl: string, name: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

async function init(baseUrl: string): Promise<void> {
  const res = await postInit(baseUrl);
  expect(res.status).toBe(201);
}

async function createEntry(
  baseUrl: string,
  body: unknown
): Promise<{ id: string } & Record<string, unknown>> {
  const res = await postEntry(baseUrl, body);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string } & Record<string, unknown>;
}

async function createFolder(baseUrl: string, name: string): Promise<{ id: string; name: string }> {
  const res = await postFolder(baseUrl, name);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

const API_KEY_ENTRY = {
  type: "api_key",
  name: "OpenRouter key",
  payload: { key: "sk-test-123", endpoint: "https://openrouter.ai/api/v1", model: "gpt-4" },
};

const NOTE_ENTRY = {
  type: "note",
  name: "SSH recovery",
  payload: { body: "ssh-ed25519 AAAA... recovery key" },
};

describe("trash: restore, permanent delete, empty trash, retention purge", () => {
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

  it("trash listing: deleted entries appear under ?deleted=true and disappear from the default list", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;
    await init(baseUrl);

    const keep = await createEntry(baseUrl, API_KEY_ENTRY);
    const trash = await createEntry(baseUrl, NOTE_ENTRY);
    const deleteRes = await deleteEntrySoft(baseUrl, trash.id);
    expect(deleteRes.status).toBe(204);

    const defaultList = (await (await getEntriesFiltered(baseUrl)).json()) as Array<{ id: string }>;
    expect(defaultList.map((e) => e.id)).toEqual([keep.id]);

    const trashList = (await (await getEntriesFiltered(baseUrl, { deleted: "true" })).json()) as Array<{
      id: string;
    }>;
    expect(trashList.map((e) => e.id)).toEqual([trash.id]);
  });

  it("restore: brings a trashed entry back into the default list and out of trash", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;
    await init(baseUrl);

    const entry = await createEntry(baseUrl, API_KEY_ENTRY);
    await deleteEntrySoft(baseUrl, entry.id);

    const restoreRes = await postRestore(baseUrl, entry.id);
    expect(restoreRes.status).toBe(200);

    const defaultList = (await (await getEntriesFiltered(baseUrl)).json()) as Array<{ id: string }>;
    expect(defaultList.map((e) => e.id)).toContain(entry.id);

    const trashList = (await (await getEntriesFiltered(baseUrl, { deleted: "true" })).json()) as Array<{
      id: string;
    }>;
    expect(trashList.map((e) => e.id)).not.toContain(entry.id);
  });

  it("restore preserves organization: folder and tags survive delete + restore unchanged", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;
    await init(baseUrl);

    const folder = await createFolder(baseUrl, "Work");
    const entry = await createEntry(baseUrl, {
      ...API_KEY_ENTRY,
      folderId: folder.id,
      tags: ["billing", "urgent"],
    });

    await deleteEntrySoft(baseUrl, entry.id);
    const restoreRes = await postRestore(baseUrl, entry.id);
    expect(restoreRes.status).toBe(200);
    const restored = (await restoreRes.json()) as { folderId: string | null; tags: string[] };
    expect(restored.folderId).toBe(folder.id);
    expect(restored.tags.sort()).toEqual(["billing", "urgent"]);
  });

  it("permanent delete: removes the entry and its entry_tags rows for good", async () => {
    harness = await startFreshApp();
    const { baseUrl, session } = harness;
    await init(baseUrl);

    const entry = await createEntry(baseUrl, { ...API_KEY_ENTRY, tags: ["billing"] });
    await deleteEntrySoft(baseUrl, entry.id);

    const permRes = await deletePermanent(baseUrl, entry.id);
    expect(permRes.status).toBe(204);

    const db = session.getDb();
    const entryRows = await db.selectFrom("entries").selectAll().where("id", "=", entry.id).execute();
    expect(entryRows).toHaveLength(0);
    const tagLinkRows = await db
      .selectFrom("entry_tags")
      .selectAll()
      .where("entry_id", "=", entry.id)
      .execute();
    expect(tagLinkRows).toHaveLength(0);
  });

  it("permanent delete refuses a live entry: 404s and leaves it untouched", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;
    await init(baseUrl);

    const entry = await createEntry(baseUrl, API_KEY_ENTRY);

    const permRes = await deletePermanent(baseUrl, entry.id);
    expect(permRes.status).toBe(404);

    const defaultList = (await (await getEntriesFiltered(baseUrl)).json()) as Array<{ id: string }>;
    expect(defaultList.map((e) => e.id)).toContain(entry.id);
  });

  it("empty trash: removes every trashed entry and reports the count, leaving live entries alone", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;
    await init(baseUrl);

    const keep = await createEntry(baseUrl, API_KEY_ENTRY);
    const trashA = await createEntry(baseUrl, { ...NOTE_ENTRY, name: "Trash A" });
    const trashB = await createEntry(baseUrl, { ...NOTE_ENTRY, name: "Trash B" });
    const trashC = await createEntry(baseUrl, { ...NOTE_ENTRY, name: "Trash C" });
    await deleteEntrySoft(baseUrl, trashA.id);
    await deleteEntrySoft(baseUrl, trashB.id);
    await deleteEntrySoft(baseUrl, trashC.id);

    const emptyRes = await postEmptyTrash(baseUrl);
    expect(emptyRes.status).toBe(200);
    expect(await emptyRes.json()).toEqual({ removed: 3 });

    const defaultList = (await (await getEntriesFiltered(baseUrl)).json()) as Array<{ id: string }>;
    expect(defaultList.map((e) => e.id)).toEqual([keep.id]);
  });

  it("retention purge removes an entry backdated past the cutoff on the next vault open", async () => {
    harness = await startFreshApp();
    const { baseUrl, session } = harness;
    await init(baseUrl);

    const entry = await createEntry(baseUrl, { ...API_KEY_ENTRY, tags: ["billing"] });
    await deleteEntrySoft(baseUrl, entry.id);

    const db = session.getDb();
    const expiredTimestamp = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await db.updateTable("entries").set({ deleted_at: expiredTimestamp }).where("id", "=", entry.id).execute();

    const lockRes = await postLock(baseUrl);
    expect(lockRes.status).toBe(204);
    const unlockRes = await postUnlock(baseUrl);
    expect(unlockRes.status).toBe(200);

    const purgedDb = session.getDb();
    const entryRows = await purgedDb.selectFrom("entries").selectAll().where("id", "=", entry.id).execute();
    expect(entryRows).toHaveLength(0);
    const tagLinkRows = await purgedDb
      .selectFrom("entry_tags")
      .selectAll()
      .where("entry_id", "=", entry.id)
      .execute();
    expect(tagLinkRows).toHaveLength(0);
  });

  it("retention purge spares an entry backdated one day inside the window", async () => {
    harness = await startFreshApp();
    const { baseUrl, session } = harness;
    await init(baseUrl);

    const entry = await createEntry(baseUrl, API_KEY_ENTRY);
    await deleteEntrySoft(baseUrl, entry.id);

    const db = session.getDb();
    const withinWindowTimestamp = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();
    await db
      .updateTable("entries")
      .set({ deleted_at: withinWindowTimestamp })
      .where("id", "=", entry.id)
      .execute();

    const lockRes = await postLock(baseUrl);
    expect(lockRes.status).toBe(204);
    const unlockRes = await postUnlock(baseUrl);
    expect(unlockRes.status).toBe(200);

    const trashList = (await (await getEntriesFiltered(baseUrl, { deleted: "true" })).json()) as Array<{
      id: string;
    }>;
    expect(trashList.map((e) => e.id)).toContain(entry.id);
  });

  it("no secrets in the trash response: no element carries a payload property", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;
    await init(baseUrl);

    const entry = await createEntry(baseUrl, API_KEY_ENTRY);
    await deleteEntrySoft(baseUrl, entry.id);

    const trashList = (await (await getEntriesFiltered(baseUrl, { deleted: "true" })).json()) as Array<
      Record<string, unknown>
    >;
    expect(trashList.length).toBeGreaterThan(0);
    for (const row of trashList) {
      expect(Object.prototype.hasOwnProperty.call(row, "payload")).toBe(false);
    }
  });
});
