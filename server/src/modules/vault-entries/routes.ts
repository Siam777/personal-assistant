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
  emptyTrash,
  EntryTypeImmutableError,
  getEntry,
  listEntries,
  permanentlyDeleteEntry,
  restoreEntry,
  softDeleteEntry,
  updateEntry,
} from "./entries.js";
import { createFolder, deleteFolder, DuplicateFolderNameError, listFolders, renameFolder } from "./folders.js";
import { listTags } from "./tags.js";
import {
  entryCreateSchema,
  entryListQuerySchema,
  entryUpdateSchema,
  folderCreateSchema,
  folderRenameSchema,
} from "./schemas.js";

export const entriesRouter = Router();

entriesRouter.use(requireUnlocked);

entriesRouter.get("/entries", (req, res, next) => {
  void (async () => {
    try {
      const parsed = entryListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      const { q, folderId, tag, deleted } = parsed.data;
      const entries = await listEntries({ q, folderId, tag, deleted: deleted === "true" });
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

// Defined before any parameterized POST /entries/:id/... route below, so
// the literal "trash" segment is never captured as an :id value.
entriesRouter.post("/entries/trash/empty", (_req, res, next) => {
  void (async () => {
    try {
      const removed = await emptyTrash();
      res.json({ removed });
    } catch (err) {
      next(err);
    }
  })();
});

entriesRouter.post("/entries/:id/restore", (req, res, next) => {
  void (async () => {
    try {
      const restored = await restoreEntry(req.params.id as string);
      if (!restored) {
        res.status(404).json({ error: "Entry not found" });
        return;
      }
      res.json(restored);
    } catch (err) {
      next(err);
    }
  })();
});

entriesRouter.delete("/entries/:id/permanent", (req, res, next) => {
  void (async () => {
    try {
      const deleted = await permanentlyDeleteEntry(req.params.id as string);
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

entriesRouter.get("/folders", (_req, res, next) => {
  void (async () => {
    try {
      const folders = await listFolders();
      res.json(folders);
    } catch (err) {
      next(err);
    }
  })();
});

entriesRouter.post("/folders", validate(folderCreateSchema), (req, res, next) => {
  void (async () => {
    try {
      const created = await createFolder((req.body as z.infer<typeof folderCreateSchema>).name);
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof DuplicateFolderNameError) {
        res.status(409).json({ error: "A folder with that name already exists" });
        return;
      }
      next(err);
    }
  })();
});

entriesRouter.patch("/folders/:id", validate(folderRenameSchema), (req, res, next) => {
  void (async () => {
    try {
      const updated = await renameFolder(
        req.params.id as string,
        (req.body as z.infer<typeof folderRenameSchema>).name
      );
      if (!updated) {
        res.status(404).json({ error: "Folder not found" });
        return;
      }
      res.json(updated);
    } catch (err) {
      if (err instanceof DuplicateFolderNameError) {
        res.status(409).json({ error: "A folder with that name already exists" });
        return;
      }
      next(err);
    }
  })();
});

entriesRouter.delete("/folders/:id", (req, res, next) => {
  void (async () => {
    try {
      const deleted = await deleteFolder(req.params.id as string);
      if (!deleted) {
        res.status(404).json({ error: "Folder not found" });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  })();
});

entriesRouter.get("/tags", (_req, res, next) => {
  void (async () => {
    try {
      const tags = await listTags();
      res.json(tags);
    } catch (err) {
      next(err);
    }
  })();
});
