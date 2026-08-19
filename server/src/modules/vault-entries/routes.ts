/**
 * Express router mounted at `/api/vault` by `app.ts`, alongside (and after)
 * `vaultRouter`. `entriesRouter.use(requireUnlocked)` is called once at
 * router level, immediately after construction — every route defined below
 * is therefore gated, with no possibility of a future route being added
 * without the gate (unlike `vaultRouter`, which has the one deliberate
 * `/status` exception).
 *
 * The unlock-oracle's tagged auth-error constructor in `errorHandler.ts`
 * (reserved exclusively for the unlock path — see that file's doc comment)
 * is never constructed here; entry CRUD failures fall through to the
 * generic 500 or are answered explicitly with a status plus an
 * `{ error: string }` body.
 */

import { Router } from "express";
import type { z } from "zod";
import { validate } from "../../middleware/validate.js";
import { requireUnlocked } from "../../middleware/requireUnlocked.js";
import {
  createEntry,
  EntryTypeImmutableError,
  getEntry,
  listEntries,
  softDeleteEntry,
  updateEntry,
} from "./entries.js";
import { entryCreateSchema, entryUpdateSchema } from "./schemas.js";

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

entriesRouter.get("/entries/:id", (req, res, next) => {
  void (async () => {
    try {
      const entry = await getEntry(req.params.id as string);
      if (!entry) {
        res.status(404).json({ error: "Entry not found" });
        return;
      }
      res.json(entry);
    } catch (err) {
      next(err);
    }
  })();
});

entriesRouter.patch("/entries/:id", validate(entryUpdateSchema), (req, res, next) => {
  void (async () => {
    try {
      const updated = await updateEntry(
        req.params.id as string,
        req.body as z.infer<typeof entryUpdateSchema>
      );
      if (!updated) {
        res.status(404).json({ error: "Entry not found" });
        return;
      }
      res.json(updated);
    } catch (err) {
      if (err instanceof EntryTypeImmutableError) {
        res.status(400).json({ error: "Entry type cannot be changed" });
        return;
      }
      next(err);
    }
  })();
});

entriesRouter.delete("/entries/:id", (req, res, next) => {
  void (async () => {
    try {
      const deleted = await softDeleteEntry(req.params.id as string);
      if (!deleted) {
        res.status(404).json({ error: "Entry not found" });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  })();
});
