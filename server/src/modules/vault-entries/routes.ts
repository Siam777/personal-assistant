/**
 * Express router mounted at `/api/vault` by `app.ts`, alongside (and after)
 * `vaultRouter`. `entriesRouter.use(requireUnlocked)` is called once at
 * router level, immediately after construction — every route defined below
 * is therefore gated, with no possibility of a future route being added
 * without the gate (unlike `vaultRouter`, which has the one deliberate
 * `/status` exception).
 *
 * `vaultAuthError()` is never constructed here — that constructor is
 * reserved for the unlock oracle (`errorHandler.ts`); entry CRUD failures
 * fall through to the generic 500 or are answered explicitly with a status
 * plus an `{ error: string }` body.
 */

import { Router } from "express";
import type { z } from "zod";
import { validate } from "../../middleware/validate.js";
import { requireUnlocked } from "../../middleware/requireUnlocked.js";
import { createEntry, listEntries } from "./entries.js";
import { entryCreateSchema } from "./schemas.js";

export const entriesRouter = Router();

entriesRouter.use(requireUnlocked);

entriesRouter.get("/entries", (_req, res, next) => {
  void (async () => {
    try {
      const entries = await listEntries();
      res.json(entries);
    } catch (err) {
      next(err);
    }
  })();
});

entriesRouter.post("/entries", validate(entryCreateSchema), (req, res, next) => {
  void (async () => {
    try {
      const created = await createEntry(req.body as z.infer<typeof entryCreateSchema>);
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  })();
});
