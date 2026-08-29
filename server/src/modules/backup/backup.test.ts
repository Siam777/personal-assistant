import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEncryptedBackup,
  decryptBackup,
  type BackupPayload,
} from "./backupCrypto.js";

const TEST_PASSWORD = "Correct Horse Battery Staple 2026!";
const BACKUP_PASSWORD = "Backup Custom Secret Passphrase 2026!";

interface Harness {
  vaultDir: string;
  baseUrl: string;
  session: typeof import("../auth/session.js");
  close: () => Promise<void>;
}

async function startFreshApp(): Promise<Harness> {
  const vaultDir = path.join(
    os.tmpdir(),
    `vault-backup-test-${randomBytes(8).toString("hex")}`
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

describe("Encrypted Backup Export & Restore Engine (BACKUP-01, BACKUP-02)", () => {
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
  }

  it("round-trips encryption and decryption of backup payload", async () => {
    const samplePayload: BackupPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: [
        {
          id: "entry-1",
          type: "login",
          name: "My Bank",
          payload: JSON.stringify({ username: "user1", password: "super-secret-bank-password" }),
          folder_id: null,
          notes: "Confidential banking details",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deleted_at: null,
        },
      ],
      folders: [{ id: "f1", name: "Finance", created_at: new Date().toISOString() }],
      tags: [{ id: "t1", name: "important", created_at: new Date().toISOString() }],
      entry_tags: [{ entry_id: "entry-1", tag_id: "t1" }],
    };

    const container = await createEncryptedBackup(samplePayload, BACKUP_PASSWORD);

    // Verify container structure
    expect(container.version).toBe(1);
    expect(container.app).toBe("personal-assistant-vault");
    expect(container.kdf.type).toBe("argon2id");
    expect(container.encryption.cipher).toBe("aes-256-gcm");

    // Verify secrets are NOT in container plaintext
    const rawContainerString = JSON.stringify(container);
    expect(rawContainerString).not.toContain("super-secret-bank-password");
    expect(rawContainerString).not.toContain("Confidential banking details");
    expect(rawContainerString).not.toContain("user1");

    // Decrypt with correct password
    const decrypted = await decryptBackup(container, BACKUP_PASSWORD);
    expect(decrypted.entries.length).toBe(1);
    expect(decrypted.entries[0].name).toBe("My Bank");
    expect(decrypted.entries[0].payload).toContain("super-secret-bank-password");

    // Decrypt with wrong password fails
    await expect(decryptBackup(container, "Wrong Password!")).rejects.toThrow(
      "Invalid backup password or corrupted backup file"
    );

    // Tampering with auth tag fails
    const corruptedContainer = {
      ...container,
      encryption: {
        ...container.encryption,
        authTagB64: Buffer.from(randomBytes(16)).toString("base64"),
      },
    };
    await expect(decryptBackup(corruptedContainer, BACKUP_PASSWORD)).rejects.toThrow(
      "Invalid backup password or corrupted backup file"
    );
  });

  it("exports vault backup via POST /api/vault/backup/export", async () => {
    await initAndUnlock();

    // Create an entry
    await fetch(`${harness.baseUrl}/api/vault/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "127.0.0.1" },
      body: JSON.stringify({
        type: "api_key",
        name: "Anthropic Claude Key",
        payload: { key: "sk-ant-api03-12345" },
        notes: "Export test note",
      }),
    });

    const exportRes = await fetch(`${harness.baseUrl}/api/vault/backup/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "127.0.0.1" },
      body: JSON.stringify({ password: BACKUP_PASSWORD }),
    });
    expect(exportRes.status).toBe(200);

    const container = (await exportRes.json()) as { app: string; [key: string]: unknown };
    expect(container.app).toBe("personal-assistant-vault");
    expect(JSON.stringify(container)).not.toContain("sk-ant-api03-12345");

    // Verify audit log has backup_exported
    const auditRes = await fetch(`${harness.baseUrl}/api/vault/audit?eventType=backup_exported`, {
      headers: { Host: "127.0.0.1" },
    });
    const auditBody = (await auditRes.json()) as { logs: Array<{ eventType: string }> };
    expect(auditBody.logs.length).toBe(1);
    expect(auditBody.logs[0].eventType).toBe("backup_exported");
  });

  it("restores backup in overwrite and merge modes", async () => {
    await initAndUnlock();

    // 1. Create original entry A
    const entryARes = await fetch(`${harness.baseUrl}/api/vault/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "127.0.0.1" },
      body: JSON.stringify({
        type: "login",
        name: "Account A",
        payload: { username: "alice", password: "password-a" },
      }),
    });
    expect(entryARes.status).toBe(201);

    // 2. Export backup with entry A
    const exportRes = await fetch(`${harness.baseUrl}/api/vault/backup/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "127.0.0.1" },
      body: JSON.stringify({ password: BACKUP_PASSWORD }),
    });
    const backupData = await exportRes.json();

    // 3. Create entry B
    await fetch(`${harness.baseUrl}/api/vault/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "127.0.0.1" },
      body: JSON.stringify({
        type: "login",
        name: "Account B",
        payload: { username: "bob", password: "password-b" },
      }),
    });

    // Verify currently 2 entries exist
    const listRes1 = await fetch(`${harness.baseUrl}/api/vault/entries`, {
      headers: { Host: "127.0.0.1" },
    });
    const list1 = (await listRes1.json()) as Array<{ id: string; name: string }>;
    expect(list1.length).toBe(2);

    // 4. Restore in MERGE mode (both A and B should exist)
    const mergeRes = await fetch(`${harness.baseUrl}/api/vault/backup/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "127.0.0.1" },
      body: JSON.stringify({
        backupData,
        password: BACKUP_PASSWORD,
        mode: "merge",
      }),
    });
    expect(mergeRes.status).toBe(200);

    const listRes2 = await fetch(`${harness.baseUrl}/api/vault/entries`, {
      headers: { Host: "127.0.0.1" },
    });
    const list2 = (await listRes2.json()) as Array<{ id: string; name: string }>;
    expect(list2.length).toBe(2);

    // 5. Restore in OVERWRITE mode (only entry A should exist, B should be deleted)
    const overwriteRes = await fetch(`${harness.baseUrl}/api/vault/backup/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "127.0.0.1" },
      body: JSON.stringify({
        backupData,
        password: BACKUP_PASSWORD,
        mode: "overwrite",
      }),
    });
    expect(overwriteRes.status).toBe(200);

    const listRes3 = await fetch(`${harness.baseUrl}/api/vault/entries`, {
      headers: { Host: "127.0.0.1" },
    });
    const list3 = (await listRes3.json()) as Array<{ id: string; name: string }>;
    expect(list3.length).toBe(1);
    expect(list3[0].name).toBe("Account A");

    // 6. Verify audit log has backup_restored
    const auditRes = await fetch(`${harness.baseUrl}/api/vault/audit?eventType=backup_restored`, {
      headers: { Host: "127.0.0.1" },
    });
    const auditBody = (await auditRes.json()) as { logs: Array<{ eventType: string }> };
    expect(auditBody.logs.length).toBe(2);
  });
});
