/**
 * Express router mounted at `/api/vault` by `app.ts`. This plan wires two
 * routes: the real `GET /status` and `POST /init`, the first-run
 * vault-creation path. Plans 01-03 and 01-04 add the rest.
 */

import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { Router } from "express";
import type { Kysely } from "kysely";
import { z } from "zod";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as zxcvbnCommonPackage from "@zxcvbn-ts/language-common";
import * as zxcvbnEnPackage from "@zxcvbn-ts/language-en";
import * as config from "../../config.js";
import { validate } from "../../middleware/validate.js";
import type { VaultMeta, VaultStatus } from "../../types.js";
import type { VaultDbSchema } from "../db/schema.js";
import { initSchema, openVaultDb } from "../db/connection.js";
import { deriveMasterKey, generateVaultKey, wrapKey } from "./crypto.js";
import * as session from "./session.js";
import {
  ensureVaultDir,
  readVaultMeta,
  vaultExists,
  writeVaultMetaAtomic,
} from "./vaultMeta.js";

// Loaded once at module scope, not per-request — dictionary/graph assembly
// is comparatively expensive and the data never changes for this process.
const zxcvbn = new ZxcvbnFactory({
  translations: zxcvbnEnPackage.translations,
  graphs: zxcvbnCommonPackage.adjacencyGraphs,
  dictionary: {
    ...zxcvbnCommonPackage.dictionary,
    ...zxcvbnEnPackage.dictionary,
  },
});

export const vaultRouter = Router();

/**
 * Reads no secret and requires no unlocked session. The client polls this,
 * and polling must never keep a session alive — so this route deliberately
 * does not sit behind `requireUnlocked`.
 */
vaultRouter.get("/status", (_req, res) => {
  const initialized = vaultExists();
  const status: VaultStatus = {
    initialized,
    unlocked: session.isUnlocked(),
    totpEnabled: initialized ? readVaultMeta().totp.enabled : false,
    idleTimeoutMs: config.IDLE_TIMEOUT_MS,
  };
  res.json(status);
});

const initBodySchema = z.object({
  masterPassword: z.string(),
  noRecoveryAcknowledged: z.literal(true),
});

vaultRouter.post("/init", validate(initBodySchema), (req, res, next) => {
  void (async () => {
    const { masterPassword } = req.body as z.infer<typeof initBodySchema>;

    // This is the one endpoint in the phase whose failure response is
    // deliberately specific rather than generic — at creation time there
    // is no secret to protect yet, and the user needs actionable feedback.
    if (vaultExists()) {
      res.status(409).json({ error: "Vault already exists" });
      return;
    }

    if (masterPassword.trim().length === 0) {
      res.status(400).json({ error: "Master password is required" });
      return;
    }

    const strength = zxcvbn.check(masterPassword);
    if (strength.score < config.MIN_PASSWORD_SCORE) {
      const feedback =
        strength.feedback.warning ??
        (strength.feedback.suggestions.length > 0
          ? strength.feedback.suggestions.join(" ")
          : "Choose a longer, less predictable password.");
      res.status(400).json({
        error: "Master password is too weak",
        score: strength.score,
        feedback,
      });
      return;
    }

    let masterKey: Buffer | null = null;
    let db: Kysely<VaultDbSchema> | null = null;

    try {
      // better-sqlite3-multiple-ciphers requires the parent directory to
      // exist before it will create vault.db, so this must happen before
      // openVaultDb, not only before writeVaultMetaAtomic.
      ensureVaultDir();

      const salt = randomBytes(16);
      masterKey = await deriveMasterKey(masterPassword, salt);
      const vaultKey = generateVaultKey();
      const wrappedVaultKey = wrapKey(vaultKey, masterKey);

      db = openVaultDb(config.VAULT_DB_PATH, vaultKey);
      await initSchema(db);

      const row = await db
        .selectFrom("schema_version")
        .selectAll()
        .executeTakeFirstOrThrow();
      if (row.version !== 1) {
        throw new Error("schema_version round-trip did not return version 1");
      }

      const meta: VaultMeta = {
        version: 1,
        createdAt: new Date().toISOString(),
        cipher: "sqlcipher",
        noRecoveryAcknowledged: true,
        kdf: {
          type: "argon2id",
          memoryCost: config.KDF_PARAMS.memoryCost,
          timeCost: config.KDF_PARAMS.timeCost,
          parallelism: config.KDF_PARAMS.parallelism,
          saltB64: salt.toString("base64"),
        },
        wrappedVaultKey,
        totp: { enabled: false, wrappedSecret: null, backupCodeHashes: [] },
      };
      writeVaultMetaAtomic(meta);

      masterKey.fill(0);
      masterKey = null;

      session.unlockSession(vaultKey, db);
      db = null; // ownership transferred to the session singleton

      const status: VaultStatus = {
        initialized: true,
        unlocked: true,
        totpEnabled: false,
        idleTimeoutMs: config.IDLE_TIMEOUT_MS,
      };
      res.status(201).json(status);
    } catch (err) {
      // A mid-sequence failure must not leave an unopenable vault behind
      // (D-05 provides no recovery path) — remove any partial artifacts.
      if (masterKey) {
        masterKey.fill(0);
      }
      if (db) {
        try {
          await db.destroy();
        } catch {
          // best-effort close before removing the file
        }
      }
      if (existsSync(config.VAULT_DB_PATH)) {
        rmSync(config.VAULT_DB_PATH, { force: true });
      }
      if (existsSync(config.VAULT_META_PATH)) {
        rmSync(config.VAULT_META_PATH, { force: true });
      }
      next(err);
    }
  })();
});
