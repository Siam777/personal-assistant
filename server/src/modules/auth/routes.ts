/**
 * Express router mounted at `/api/vault` by `app.ts`. Wires the real
 * `GET /status`, `POST /init` (Plan 01-02), and `POST /unlock` / `POST
 * /lock` (this plan). Plan 01-04 adds 2FA enrollment/management routes.
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
import { vaultAuthError } from "../../middleware/errorHandler.js";
import { unlockRateLimit } from "../../middleware/rateLimit.js";
import { validate } from "../../middleware/validate.js";
import type { VaultMeta, VaultStatus } from "../../types.js";
import type { VaultDbSchema } from "../db/schema.js";
import { initSchema, openVaultDb } from "../db/connection.js";
import { deriveMasterKey, generateVaultKey, unwrapKey, wrapKey } from "./crypto.js";
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

// The optional `totpCode` field is defined from this plan onward even
// though nothing populates it until Plan 01-04 — see this plan's
// <assumption_delta_decision> block. Submitting it now avoids a later
// request-contract migration.
const unlockBodySchema = z.object({
  masterPassword: z.string(),
  totpCode: z.string().optional(),
});

vaultRouter.post(
  "/unlock",
  unlockRateLimit,
  validate(unlockBodySchema),
  (req, res, next) => {
    void (async () => {
      const { masterPassword } = req.body as z.infer<typeof unlockBodySchema>;

      // A state fact the client already learns from GET /status, not a
      // secret — the vault-does-or-doesn't-exist distinction is not part
      // of the password-correctness oracle this route otherwise protects.
      if (!vaultExists()) {
        res.status(409).json({ error: "Vault does not exist" });
        return;
      }

      if (session.isUnlocked()) {
        const meta = readVaultMeta();
        const status: VaultStatus = {
          initialized: true,
          unlocked: true,
          totpEnabled: meta.totp.enabled,
          idleTimeoutMs: config.IDLE_TIMEOUT_MS,
        };
        res.status(200).json(status);
        return;
      }

      let masterKey: Buffer | null = null;
      let db: Kysely<VaultDbSchema> | null = null;

      try {
        const meta = readVaultMeta();
        const salt = Buffer.from(meta.kdf.saltB64, "base64");

        // Key derivation runs before any check that could short-circuit
        // the response — including the totp.enabled branch below — so
        // response timing never becomes a second oracle alongside the
        // auth-tag check inside unwrapKey.
        masterKey = await deriveMasterKey(masterPassword, salt, {
          memoryCost: meta.kdf.memoryCost,
          timeCost: meta.kdf.timeCost,
          parallelism: meta.kdf.parallelism,
        });

        // unwrapKey throws on an auth-tag mismatch — that throw IS the
        // password-correctness oracle, caught below and converted to the
        // single generic failure.
        const vaultKey = unwrapKey(meta.wrappedVaultKey, masterKey);
        db = openVaultDb(config.VAULT_DB_PATH, vaultKey);

        if (meta.totp.enabled) {
          // No second-factor verifier exists yet — Plan 01-04 supplies
          // one. Fail closed rather than unlock a vault whose second
          // factor cannot currently be checked.
          throw vaultAuthError();
        }

        session.unlockSession(vaultKey, db);
        db = null; // ownership transferred to the session singleton

        masterKey.fill(0);
        masterKey = null;

        const status: VaultStatus = {
          initialized: true,
          unlocked: true,
          totpEnabled: meta.totp.enabled,
          idleTimeoutMs: config.IDLE_TIMEOUT_MS,
        };
        res.status(200).json(status);
      } catch {
        // Every failure on this route — auth-tag mismatch, a failed
        // forcing read, an unreadable/malformed sidecar, or a bad second
        // factor — collapses to the same byte-identical response. Never
        // pass the original error through: even its type/shape could
        // distinguish one failure cause from another.
        if (masterKey) {
          masterKey.fill(0);
        }
        if (db) {
          try {
            await db.destroy();
          } catch {
            // best-effort close; the vault stays locked either way
          }
        }
        next(vaultAuthError());
      }
    })();
  }
);

/**
 * Safe to call when already locked and safe to call repeatedly — the
 * client fires this from page lifecycle events that may or may not have a
 * live session behind them (`session-signals.ts`).
 */
vaultRouter.post("/lock", (_req, res) => {
  session.lock();
  res.status(204).end();
});
