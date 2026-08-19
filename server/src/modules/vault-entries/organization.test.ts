/**
 * Proves folder, tag, and search behaviour end to end through a real
 * encrypted vault. Harness mirrors `entries.test.ts`'s `startFreshApp`: a
 * fresh temp `VAULT_DIR` and a fresh module registry per test.
 */

import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { sql } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";

interface Harness {
  vaultDir: string;
  baseUrl: string;
  session: typeof import("../auth/session.js");
  close: () => Promise<void>;
}

async function startFreshApp(): Promise<Harness> {
  const vaultDir = path.join(os.tmpdir(), `vault-organization-test-${randomBytes(8).toString("hex")}`);
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

function postEntry(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchEntry(baseUrl: string, id: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/entries/${id}`, {
    method: "PATCH",
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

function postFolder(baseUrl: string, name: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

function deleteFolderReq(baseUrl: string, id: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/folders/${id}`, { method: "DELETE" });
}

function getTags(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/tags`);
}

function getFolders(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/folders`);
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

describe("folders, tags, and search", () => {
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

  it("folder assignment: an entry created in a folder is returned by GET /entries?folderId=", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;
    await init(baseUrl);

    const folder = await createFolder(baseUrl, "Work");
    const entryA = await createEntry(baseUrl, { ...API_KEY_ENTRY, folderId: folder.id });
    const entryB = await createEntry(baseUrl, { ...NOTE_ENTRY, folderId: folder.id });
    await createEntry(baseUrl, API_KEY_ENTRY); // unfoliated control entry

    const res = await getEntriesFiltered(baseUrl, { folderId: folder.id });
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ id: string }>;
    expect(list.map((e) => e.id).sort()).toEqual([entryA.id, entryB.id].sort());
  });

  it("folder delete uncategorizes its entries rather than deleting them", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;
    await init(baseUrl);

    const folder = await createFolder(baseUrl, "Work");
    const entryA = await createEntry(baseUrl, { ...API_KEY_ENTRY, folderId: folder.id });
    const entryB = await createEntry(baseUrl, { ...NOTE_ENTRY, folderId: folder.id });

    const deleteRes = await deleteFolderReq(baseUrl, folder.id);
    expect(deleteRes.status).toBe(204);

    const listRes = await getEntriesFiltered(baseUrl);
    const list = (await listRes.json()) as Array<{ id: string; folderId: string | null }>;
    const foundA = list.find((e) => e.id === entryA.id);
    const foundB = list.find((e) => e.id === entryB.id);
    expect(foundA).toBeDefined();
    expect(foundB).toBeDefined();
    expect(foundA?.folderId).toBeNull();
    expect(foundB?.folderId).toBeNull();
  });

  it("folders are flat: the folders table has no column whose name contains 'parent'", async () => {
    harness = await startFreshApp();
    const { baseUrl, session } = harness;
    await init(baseUrl);

    const db = session.getDb();
    const result = await sql<{ name: string }>`PRAGMA table_info(folders)`.execute(db);
    const hasParentColumn = result.rows.some((column) => column.name.toLowerCase().includes("parent"));
    expect(hasParentColumn).toBe(false);
  });

  it("rejects a duplicate folder name with 409", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;
    await init(baseUrl);

    const firstRes = await postFolder(baseUrl, "Work");
    expect(firstRes.status).toBe(201);

    const secondRes = await postFolder(baseUrl, "Work");
    expect(secondRes.status).toBe(409);
  });

  it("creates a tag on the fly and reuses it by name across entries", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;
    await init(baseUrl);

    await createEntry(baseUrl, { ...API_KEY_ENTRY, tags: ["work"] });
    await createEntry(baseUrl, { ...NOTE_ENTRY, tags: ["work"] });

    const tagsRes = await getTags(baseUrl);
    expect(tagsRes.status).toBe(200);
    const tags = (await tagsRes.json()) as Array<{ name: string; entryCount: number }>;
    const workTags = tags.filter((t) => t.name === "work");
    expect(workTags).toHaveLength(1);
    expect(workTags[0]?.entryCount).toBe(2);
  });

  it("filters entries by tag", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;
    await init(baseUrl);

    const entryA = await createEntry(baseUrl, { ...API_KEY_ENTRY, tags: ["work"] });
    const entryB = await createEntry(baseUrl, { ...NOTE_ENTRY, tags: ["work"] });
    await createEntry(baseUrl, API_KEY_ENTRY); // untagged control entry

    const res = await getEntriesFiltered(baseUrl, { tag: "work" });
    const list = (await res.json()) as Array<{ id: string }>;
    expect(list.map((e) => e.id).sort()).toEqual([entryA.id, entryB.id].sort());
  });

  it("replacing an entry's tags removes the old link and adds the new one", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;
    await init(baseUrl);

    const entryA = await createEntry(baseUrl, { ...API_KEY_ENTRY, tags: ["work"] });
    const entryB = await createEntry(baseUrl, { ...NOTE_ENTRY, tags: ["work"] });

    const patchRes = await patchEntry(baseUrl, entryA.id, {
      ...API_KEY_ENTRY,
      folderId: null,
      notes: null,
      tags: ["personal"],
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { tags: string[] };
    expect(patched.tags).toEqual(["personal"]);

    const res = await getEntriesFiltered(baseUrl, { tag: "work" });
    const list = (await res.json()) as Array<{ id: string }>;
    expect(list.map((e) => e.id)).toEqual([entryB.id]);
  });

  it("finds an entry by name, by its folder's name, and by one of its tag names", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;
    await init(baseUrl);

    const folder = await createFolder(baseUrl, "Personal Finance");
    const entry = await createEntry(baseUrl, {
      ...API_KEY_ENTRY,
      name: "Stripe production key",
      folderId: folder.id,
      tags: ["billing"],
    });

    const byName = await getEntriesFiltered(baseUrl, { q: "Stripe" });
    const byNameList = (await byName.json()) as Array<{ id: string }>;
    expect(byNameList.some((e) => e.id === entry.id)).toBe(true);

    const byFolder = await getEntriesFiltered(baseUrl, { q: "Personal Finance" });
    const byFolderList = (await byFolder.json()) as Array<{ id: string }>;
    expect(byFolderList.some((e) => e.id === entry.id)).toBe(true);

    const byTag = await getEntriesFiltered(baseUrl, { q: "billing" });
    const byTagList = (await byTag.json()) as Array<{ id: string }>;
    expect(byTagList.some((e) => e.id === entry.id)).toBe(true);
  });

  it("returns both entries for an exact-name match and for a substring match, never collapsing them", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;
    await init(baseUrl);

    const sharedName = "Duplicate Name Entry";
    const entryA = await createEntry(baseUrl, { ...API_KEY_ENTRY, name: sharedName });
    const entryB = await createEntry(baseUrl, { ...NOTE_ENTRY, name: sharedName });

    const exactRes = await getEntriesFiltered(baseUrl, { q: sharedName });
    const exactList = (await exactRes.json()) as Array<{ id: string }>;
    expect(exactList.map((e) => e.id).sort()).toEqual([entryA.id, entryB.id].sort());

    const substringRes = await getEntriesFiltered(baseUrl, { q: "Duplicate Name" });
    const substringList = (await substringRes.json()) as Array<{ id: string }>;
    expect(substringList.map((e) => e.id).sort()).toEqual([entryA.id, entryB.id].sort());
  });

  it("an empty or whitespace-only query returns the full unfiltered list", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;
    await init(baseUrl);

    await createEntry(baseUrl, API_KEY_ENTRY);
    await createEntry(baseUrl, NOTE_ENTRY);

    const emptyRes = await getEntriesFiltered(baseUrl, { q: "" });
    const emptyList = (await emptyRes.json()) as unknown[];
    expect(emptyList).toHaveLength(2);

    const blankRes = await getEntriesFiltered(baseUrl, { q: " " });
    const blankList = (await blankRes.json()) as unknown[];
    expect(blankList).toHaveLength(2);
  });

  it("treats a wildcard character in the search term literally, not as a SQL wildcard", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;
    await init(baseUrl);

    await createEntry(baseUrl, { ...API_KEY_ENTRY, name: "prod" });

    const res = await getEntriesFiltered(baseUrl, { q: "%" });
    const list = (await res.json()) as unknown[];
    expect(list).toHaveLength(0);
  });

  it("returns entries sharing an updated_at value in the same order across repeated identical requests", async () => {
    harness = await startFreshApp();
    const { baseUrl, session } = harness;
    await init(baseUrl);

    const entryA = await createEntry(baseUrl, { ...API_KEY_ENTRY, name: "Entry A" });
    const entryB = await createEntry(baseUrl, { ...NOTE_ENTRY, name: "Entry B" });
    await createEntry(baseUrl, { ...API_KEY_ENTRY, name: "Entry C" });

    const db = session.getDb();
    const sharedTimestamp = "2026-01-01T00:00:00.000Z";
    await db
      .updateTable("entries")
      .set({ updated_at: sharedTimestamp })
      .where("id", "in", [entryA.id, entryB.id])
      .execute();

    const firstRes = await getEntriesFiltered(baseUrl);
    const firstIds = ((await firstRes.json()) as Array<{ id: string }>).map((e) => e.id);

    const secondRes = await getEntriesFiltered(baseUrl);
    const secondIds = ((await secondRes.json()) as Array<{ id: string }>).map((e) => e.id);

    expect(secondIds).toEqual(firstIds);
  });

  it("composes folder, tag, and search filters together", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;
    await init(baseUrl);

    const folder = await createFolder(baseUrl, "Work");
    const other = await createFolder(baseUrl, "Other");

    const matching = await createEntry(baseUrl, {
      ...API_KEY_ENTRY,
      name: "Composed match",
      folderId: folder.id,
      tags: ["billing"],
    });
    // Same tag, wrong folder.
    await createEntry(baseUrl, { ...API_KEY_ENTRY, name: "Composed match", folderId: other.id, tags: ["billing"] });
    // Same folder and tag, wrong name.
    await createEntry(baseUrl, { ...NOTE_ENTRY, name: "Unrelated", folderId: folder.id, tags: ["billing"] });
    // Same folder and name, wrong tag.
    await createEntry(baseUrl, { ...NOTE_ENTRY, name: "Composed match", folderId: folder.id, tags: ["other-tag"] });

    const res = await getEntriesFiltered(baseUrl, { folderId: folder.id, tag: "billing", q: "Composed" });
    const list = (await res.json()) as Array<{ id: string }>;
    expect(list.map((e) => e.id)).toEqual([matching.id]);
  });

  it("never includes a payload property on any element of the entries, folders, or tags collection responses", async () => {
    harness = await startFreshApp();
    const { baseUrl } = harness;
    await init(baseUrl);

    const folder = await createFolder(baseUrl, "Work");
    await createEntry(baseUrl, { ...API_KEY_ENTRY, folderId: folder.id, tags: ["work"] });

    const entriesRes = await getEntriesFiltered(baseUrl);
    const entries = (await entriesRes.json()) as Array<Record<string, unknown>>;
    const foldersRes = await getFolders(baseUrl);
    const folders = (await foldersRes.json()) as Array<Record<string, unknown>>;
    const tagsRes = await getTags(baseUrl);
    const tags = (await tagsRes.json()) as Array<Record<string, unknown>>;

    for (const collection of [entries, folders, tags]) {
      expect(collection.length).toBeGreaterThan(0);
      for (const item of collection) {
        expect(Object.prototype.hasOwnProperty.call(item, "payload")).toBe(false);
      }
    }
  });
});
