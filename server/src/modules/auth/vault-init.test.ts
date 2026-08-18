/**
 * The tracer's end-to-end proof: a real HTTP request through the real
 * Express app produces a genuinely encrypted vault on disk with no
 * plaintext leakage. Each test gets a fresh temp `VAULT_DIR` and a fresh
 * module registry (via `vi.resetModules()`), because `config.ts` reads
 * `process.env.VAULT_DIR` once at module-evaluation time.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { afterEach, describe, expect, it, vi } from "vitest";

interface Harness {
  vaultDir: string;
  baseUrl: string;
  config: typeof import("../../config.js");
  crypto: typeof import("./crypto.js");
  vaultMeta: typeof import("./vaultMeta.js");
  connection: typeof import("../db/connection.js");
  session: typeof import("./session.js");
  close: () => Promise<void>;
}

async function startFreshApp(): Promise<Harness> {
  // Deliberately NOT pre-created (unlike mkdtempSync) — a truly fresh
  // checkout has no `.vault/` directory at all, and the init path must
  // create it itself. Pre-creating this directory in the test harness
  // previously masked a real bug where openVaultDb() ran before the
  // directory existed.
  const vaultDir = path.join(
    os.tmpdir(),
    `vault-init-test-${randomBytes(8).toString("hex")}`
  );
  process.env.VAULT_DIR = vaultDir;
  vi.resetModules();

  const config = await import("../../config.js");
  const crypto = await import("./crypto.js");
  const vaultMeta = await import("./vaultMeta.js");
  const connection = await import("../db/connection.js");
  const session = await import("./session.js");
  const { startServer } = await import("../../app.js");

  const server = await startServer(config.HOST, 0);
  const address = server.address() as AddressInfo;
  const baseUrl = `http://${config.HOST}:${address.port}`;

  return {
    vaultDir,
    baseUrl,
    config,
    crypto,
    vaultMeta,
    connection,
    session,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function postInit(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/vault/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// High-entropy, not a dictionary word — scores well above MIN_PASSWORD_SCORE.
const STRONG_PASSWORD = randomBytes(32).toString("base64url");

describe("POST /api/vault/init — tracer end-to-end", () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    if (harness) {
      try {
        harness.session.lock();
      } catch {
        // best effort — some tests never unlock a session
      }
      await harness.close();
      try {
        rmSync(harness.vaultDir, { recursive: true, force: true });
      } catch {
        // Windows may briefly hold a file handle after an async Kysely
        // destroy(); cleanup is best-effort and does not affect assertions.
      }
      harness = undefined;
    }
    delete process.env.VAULT_DIR;
  });

  it(
    "creates a genuinely encrypted vault, reports it initialized/unlocked, round-trips a row, and refuses a second init untouched",
    async () => {
      harness = await startFreshApp();
      const { baseUrl, config } = harness;

    // (1) strong password + acknowledgement -> 201, initialized + unlocked
    const initRes = await postInit(baseUrl, {
      masterPassword: STRONG_PASSWORD,
      noRecoveryAcknowledged: true,
    });
    expect(initRes.status).toBe(201);
    const status: unknown = await initRes.json();
    expect(status).toEqual({
      initialized: true,
      unlocked: true,
      totpEnabled: false,
      idleTimeoutMs: config.IDLE_TIMEOUT_MS,
    });

    // (2) both vault files exist afterwards
    expect(existsSync(config.VAULT_META_PATH)).toBe(true);
    expect(existsSync(config.VAULT_DB_PATH)).toBe(true);

    // (3) unkeyed open throws on the first real read, and the file's first
    // 16 bytes are not the plaintext SQLite header magic.
    const dbBytes = readFileSync(config.VAULT_DB_PATH);
    const sqliteMagic = Buffer.from("SQLite format 3\0", "utf-8");
    expect(dbBytes.subarray(0, 16).equals(sqliteMagic)).toBe(false);

    const unkeyed = new Database(config.VAULT_DB_PATH, { fileMustExist: true });
    expect(() => unkeyed.pragma("user_version")).toThrow();
    unkeyed.close();

    // (4) the sidecar's raw bytes never contain the master password, in
    // either UTF-8 or base64 form.
    const metaRaw = readFileSync(config.VAULT_META_PATH, "utf-8");
    expect(metaRaw.includes(STRONG_PASSWORD)).toBe(false);
    expect(
      metaRaw.includes(Buffer.from(STRONG_PASSWORD, "utf-8").toString("base64"))
    ).toBe(false);

    // (5) the schema_version row read back during init has version 1 —
    // verified independently by re-deriving the Vault Key from the sidecar
    // and reopening the encrypted connection.
    const meta = harness.vaultMeta.readVaultMeta();
    const salt = Buffer.from(meta.kdf.saltB64, "base64");
    const masterKey = await harness.crypto.deriveMasterKey(STRONG_PASSWORD, salt);
    const vaultKey = harness.crypto.unwrapKey(meta.wrappedVaultKey, masterKey);
    const reopened = harness.connection.openVaultDb(config.VAULT_DB_PATH, vaultKey);
    const row = await reopened
      .selectFrom("schema_version")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(row.version).toBe(1);
    await reopened.destroy();

    // (6) a second init attempt is refused and leaves both existing files
    // byte-identical.
    const metaBefore = readFileSync(config.VAULT_META_PATH);
    const dbBefore = readFileSync(config.VAULT_DB_PATH);

    const secondRes = await postInit(baseUrl, {
      masterPassword: STRONG_PASSWORD,
      noRecoveryAcknowledged: true,
    });
    expect(secondRes.status).toBe(409);

      expect(readFileSync(config.VAULT_META_PATH).equals(metaBefore)).toBe(true);
      expect(readFileSync(config.VAULT_DB_PATH).equals(dbBefore)).toBe(true);
    },
    // Two full Argon2id derivations (init + independent re-derivation for
    // verification) at ~474ms measured cost each, plus module-reset/native-
    // reload overhead, comfortably exceed vitest's 5000ms default.
    20000
  );

  it("refuses init with the no-recovery acknowledgement absent or false, creating no files", async () => {
    harness = await startFreshApp();
    const { baseUrl, config } = harness;

    const missingAckRes = await postInit(baseUrl, {
      masterPassword: STRONG_PASSWORD,
    });
    expect(missingAckRes.status).toBe(400);

    const falseAckRes = await postInit(baseUrl, {
      masterPassword: STRONG_PASSWORD,
      noRecoveryAcknowledged: false,
    });
    expect(falseAckRes.status).toBe(400);

    expect(existsSync(config.VAULT_META_PATH)).toBe(false);
    expect(existsSync(config.VAULT_DB_PATH)).toBe(false);
  });

  it("refuses an empty password and a common dictionary-word password, creating no files", async () => {
    harness = await startFreshApp();
    const { baseUrl, config } = harness;

    const emptyRes = await postInit(baseUrl, {
      masterPassword: "",
      noRecoveryAcknowledged: true,
    });
    expect(emptyRes.status).toBe(400);

    const weakRes = await postInit(baseUrl, {
      masterPassword: "password",
      noRecoveryAcknowledged: true,
    });
    expect(weakRes.status).toBe(400);
    const weakBody = (await weakRes.json()) as { score?: number };
    expect(weakBody.score).toBeLessThan(config.MIN_PASSWORD_SCORE);

    expect(existsSync(config.VAULT_META_PATH)).toBe(false);
    expect(existsSync(config.VAULT_DB_PATH)).toBe(false);
  });
});
