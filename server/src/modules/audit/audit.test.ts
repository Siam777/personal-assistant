import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_PASSWORD = "Correct Horse Battery Staple 2026!";

interface Harness {
  vaultDir: string;
  baseUrl: string;
  session: typeof import("../auth/session.js");
  close: () => Promise<void>;
}

async function startFreshApp(): Promise<Harness> {
  const vaultDir = path.join(
    os.tmpdir(),
    `vault-audit-test-${randomBytes(8).toString("hex")}`
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
    session,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

describe("Audit Logging Subsystem (TRUST-03)", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startFreshApp();
  });

  afterEach(async () => {
    if (harness) {
      harness.session.lock();
      await harness.close();
      rmSync(harness.vaultDir, { recursive: true, force: true });
    }
  });

  async function initAndUnlock(): Promise<void> {
    const initRes = await fetch(`${harness.baseUrl}/api/vault/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "127.0.0.1" },
      body: JSON.stringify({ masterPassword: TEST_PASSWORD, noRecoveryAcknowledged: true }),
    });
    expect(initRes.status).toBe(201);

    const unlockRes = await fetch(`${harness.baseUrl}/api/vault/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "127.0.0.1" },
      body: JSON.stringify({ masterPassword: TEST_PASSWORD }),
    });
    expect(unlockRes.status).toBe(200);
  }

  it("requires an unlocked session to query audit logs", async () => {
    const res = await fetch(`${harness.baseUrl}/api/vault/audit`, {
      headers: { Host: "127.0.0.1" },
    });
    expect(res.status).toBe(401);
  });

  it("directly tests getAuditLogs function", async () => {
    await initAndUnlock();
    const { getAuditLogs, recordAuditEvent } = await import("./audit.js");
    const db = harness.session.getDb();
    await recordAuditEvent(db, { eventType: "vault_unlocked" });
    const res = await getAuditLogs(db);
    expect(res.logs.length).toBeGreaterThan(0);
  });

  it("records vault_unlocked on unlock and records entry CRUD events", async () => {
    await initAndUnlock();

    // 1. Check audit log for vault_unlocked
    const auditRes1 = await fetch(`${harness.baseUrl}/api/vault/audit`, {
      headers: { Host: "127.0.0.1" },
    });
    expect(auditRes1.status).toBe(200);
    const body1 = (await auditRes1.json()) as { logs: Array<{ eventType: string }>; total: number };
    expect(body1.logs.length).toBeGreaterThanOrEqual(1);
    expect(body1.logs.some((l) => l.eventType === "vault_unlocked")).toBe(true);

    // 2. Create an API key entry
    const createRes = await fetch(`${harness.baseUrl}/api/vault/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "127.0.0.1" },
      body: JSON.stringify({
        type: "api_key",
        name: "Test API Key",
        payload: { key: "super-secret-api-key-12345" },
      }),
    });
    expect(createRes.status).toBe(201);
    const entry = (await createRes.json()) as { id: string };

    // 3. View the entry
    const viewRes = await fetch(`${harness.baseUrl}/api/vault/entries/${entry.id}`, {
      headers: { Host: "127.0.0.1" },
    });
    expect(viewRes.status).toBe(200);

    // 4. Update the entry
    const updateRes = await fetch(`${harness.baseUrl}/api/vault/entries/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Host: "127.0.0.1" },
      body: JSON.stringify({
        type: "api_key",
        name: "Updated API Key",
        payload: { key: "new-secret-key-99999" },
        folderId: null,
        notes: null,
        tags: [],
      }),
    });
    expect(updateRes.status).toBe(200);

    // 5. Delete the entry
    const deleteRes = await fetch(`${harness.baseUrl}/api/vault/entries/${entry.id}`, {
      method: "DELETE",
      headers: { Host: "127.0.0.1" },
    });
    expect(deleteRes.status).toBe(204);

    // 6. Query audit logs and verify events
    const auditRes2 = await fetch(`${harness.baseUrl}/api/vault/audit`, {
      headers: { Host: "127.0.0.1" },
    });
    expect(auditRes2.status).toBe(200);
    const body2 = (await auditRes2.json()) as { logs: Array<{ eventType: string }>; total: number };

    const eventTypes = body2.logs.map((l) => l.eventType);
    expect(eventTypes).toContain("entry_created");
    expect(eventTypes).toContain("entry_viewed");
    expect(eventTypes).toContain("entry_updated");
    expect(eventTypes).toContain("entry_deleted");

    // 7. Verify NO secret strings exist anywhere in the audit log response
    const rawAuditJson = JSON.stringify(body2);
    expect(rawAuditJson).not.toContain("super-secret-api-key-12345");
    expect(rawAuditJson).not.toContain("new-secret-key-99999");
    expect(rawAuditJson).not.toContain(TEST_PASSWORD);
  });

  it("records client-side secret_revealed and secret_copied events via POST /api/vault/audit/events", async () => {
    await initAndUnlock();

    const postEventRes = await fetch(`${harness.baseUrl}/api/vault/audit/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "127.0.0.1" },
      body: JSON.stringify({
        eventType: "secret_copied",
        entryId: "test-entry-uuid",
        entryName: "Production Database Password",
        entryType: "login",
        fieldName: "password",
      }),
    });
    expect(postEventRes.status).toBe(201);

    const auditRes = await fetch(`${harness.baseUrl}/api/vault/audit?eventType=secret_copied`, {
      headers: { Host: "127.0.0.1" },
    });
    expect(auditRes.status).toBe(200);
    const body = (await auditRes.json()) as {
      logs: Array<{
        eventType: string;
        entryName?: string;
        details?: { fieldName?: string };
      }>;
      total: number;
    };
    expect(body.logs.length).toBe(1);
    expect(body.logs[0].eventType).toBe("secret_copied");
    expect(body.logs[0].entryName).toBe("Production Database Password");
    expect(body.logs[0].details?.fieldName).toBe("password");
  });

  it("filters audit logs by entryId", async () => {
    await initAndUnlock();

    await fetch(`${harness.baseUrl}/api/vault/audit/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "127.0.0.1" },
      body: JSON.stringify({
        eventType: "secret_copied",
        entryId: "entry-111",
        entryName: "Entry 111",
      }),
    });

    await fetch(`${harness.baseUrl}/api/vault/audit/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "127.0.0.1" },
      body: JSON.stringify({
        eventType: "secret_copied",
        entryId: "entry-222",
        entryName: "Entry 222",
      }),
    });

    const res = await fetch(`${harness.baseUrl}/api/vault/audit?entryId=entry-111`, {
      headers: { Host: "127.0.0.1" },
    });
    const body = (await res.json()) as { logs: Array<{ entryId?: string }>; total: number };
    expect(body.logs.length).toBe(1);
    expect(body.logs[0].entryId).toBe("entry-111");
  });
});
