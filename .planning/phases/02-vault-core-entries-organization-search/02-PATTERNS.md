# Phase 2: Vault Core — Entries, Organization & Search - Pattern Map

**Mapped:** 2026-08-19
**Files analyzed:** 13
**Analogs found:** 13 / 13

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `server/src/modules/db/schema.ts` (extend) | model | CRUD | `server/src/modules/db/schema.ts` (existing, extend in place) | exact |
| `server/src/modules/db/connection.ts` (extend `initSchema`) | model | CRUD | `server/src/modules/db/connection.ts` (existing, extend in place) | exact |
| `server/src/modules/vault-entries/routes.ts` | controller/route | CRUD + request-response | `server/src/modules/auth/routes.ts` | exact (module shape) |
| `server/src/modules/vault-entries/entries.ts` (service layer: create/update/soft-delete/restore/purge) | service | CRUD | `server/src/modules/auth/vaultMeta.ts` + `session.ts` (db access pattern) | role-match |
| `server/src/modules/vault-entries/folders.ts` | service | CRUD | `server/src/modules/auth/vaultMeta.ts` | role-match |
| `server/src/modules/vault-entries/tags.ts` | service | CRUD (many-to-many) | `server/src/modules/auth/vaultMeta.ts` | role-match |
| `server/src/modules/vault-entries/search.ts` | service | request-response (query/transform) | `server/src/modules/auth/totp.ts` (module of pure functions called from routes.ts) | role-match |
| `server/src/modules/vault-entries/schemas.ts` (Zod per-type payload schemas) | utility | transform/validation | `server/src/modules/auth/routes.ts` (inline `z.object` schemas) | role-match |
| `server/src/modules/vault-entries/*.test.ts` | test | request-response | `server/src/modules/auth/unlock.test.ts` | exact |
| `client/src/lib/api.ts` (extend with entry/folder/tag/search endpoints) | utility | request-response | `client/src/lib/api.ts` (existing, extend in place) | exact |
| `client/src/features/vault-entries/EntryListScreen.tsx` | component | request-response | `client/src/features/vault-2fa/TwoFactorSettings.tsx` (list/panel orchestrator) | role-match |
| `client/src/features/vault-entries/EntryForm.tsx` | component | request-response (form) | `client/src/features/vault-unlock/UnlockScreen.tsx` | exact (form shape) |
| `client/src/features/vault-entries/EntryDetail.tsx` | component | request-response | `client/src/features/vault-2fa/BackupCodesPanel.tsx` (reveal/mask pattern) | role-match |
| `client/src/features/vault-entries/FolderSidebar.tsx`, `TagFilter.tsx`, `SearchBar.tsx`, `TrashView.tsx`, `PasswordGenerator.tsx` | component | request-response / CRUD | `client/src/features/vault-2fa/*.tsx` | role-match |

## Pattern Assignments

### `server/src/modules/db/schema.ts` (extend)

**Analog:** itself (existing file, extend the `VaultDbSchema` interface)

**Current shape** (lines 1-11):
```typescript
export interface VaultDbSchema {
  schema_version: { version: number; applied_at: string };
}
```

**Pattern to follow:** add sibling table interfaces in the same file, e.g.:
```typescript
export interface VaultDbSchema {
  schema_version: { version: number; applied_at: string };
  entries: {
    id: string;
    type: "api_key" | "login" | "note" | "card";
    name: string;
    folder_id: string | null;
    payload: string; // encrypted-at-rest JSON blob (whole-DB-file encryption covers this)
    notes: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  };
  folders: { id: string; name: string; created_at: string };
  tags: { id: string; name: string; created_at: string };
  entry_tags: { entry_id: string; tag_id: string };
}
```
Kysely interfaces are plain TS — no decorators, no separate migration DSL. Column nullability matches D-06 (`folder_id` nullable) and D-04 (`deleted_at` nullable, soft delete).

---

### `server/src/modules/db/connection.ts` (extend `initSchema`)

**Analog:** itself, `initSchema` function (lines 46-58)

**Core pattern to replicate per new table:**
```typescript
await db.schema
  .createTable("entries")
  .ifNotExists()
  .addColumn("id", "text", (col) => col.primaryKey())
  .addColumn("type", "text", (col) => col.notNull())
  .addColumn("name", "text", (col) => col.notNull())
  .addColumn("folder_id", "text")
  .addColumn("payload", "text", (col) => col.notNull())
  .addColumn("notes", "text")
  .addColumn("created_at", "text", (col) => col.notNull())
  .addColumn("updated_at", "text", (col) => col.notNull())
  .addColumn("deleted_at", "text")
  .execute();
```
Note: `initSchema` currently only runs at vault-creation time (`POST /init`); Phase 2 needs these new tables created there too since there is no separate migration runner in this stack (`.planning/research/STACK.md`: "no ORM push/migrate command"). Statement order and `ifNotExists()` convention must be preserved exactly as in the existing `schema_version` table creation.

---

### `server/src/modules/vault-entries/routes.ts` (controller, request-response)

**Analog:** `server/src/modules/auth/routes.ts`

**Imports pattern** (lines 1-37):
```typescript
import { Router } from "express";
import { z } from "zod";
import { requireUnlocked } from "../../middleware/requireUnlocked.js";
import { validate } from "../../middleware/validate.js";
import { getDb } from "../auth/session.js";
// + module-local service imports (entries.ts, folders.ts, tags.ts, search.ts)
```

**Router + gating pattern** (mirrors lines 50-66, 332-341):
```typescript
export const entriesRouter = Router();

// ALL entry/folder/tag/search routes sit behind requireUnlocked — no
// exceptions, unlike vaultRouter's /status which deliberately opts out.
entriesRouter.use(requireUnlocked);

entriesRouter.get("/entries", (req, res, next) => {
  void (async () => {
    try {
      const db = getDb();
      const rows = await db.selectFrom("entries")...execute();
      res.json(rows);
    } catch (err) {
      next(err);
    }
  })();
})；
```
(async handlers wrapped in `void (async () => { try/catch { next(err) } })()` — see routes.ts lines 73-183, 194-293 — this is the load-bearing async-error pattern; Express 4 does not auto-catch rejected promises.)

**Validation pattern** (lines 68-72, 189-192, 343-347): define a `z.object({...})` schema per route body shape immediately above the route, pass through `validate(schema)` middleware, and read `req.body as z.infer<typeof schema>` inside the handler. Apply this per-entry-type via `schemas.ts` (see below) rather than one loose schema for all four types.

**Response shape convention:** JSON body on success (200/201/204 for no-content like delete/lock), `{ error: string }` on failure — never leak internal detail (see Shared Patterns > Error Handling below).

---

### `server/src/modules/vault-entries/entries.ts` / `folders.ts` / `tags.ts` (service, CRUD)

**Analog:** `server/src/modules/auth/vaultMeta.ts` pattern (module of small, single-purpose functions operating on the unlocked session's resources) combined with direct Kysely queries against `getDb()` from `session.ts`.

**DB access pattern** (from `session.ts` lines 26-39):
```typescript
import { getDb } from "../auth/session.js";

export async function createEntry(input: NewEntryInput): Promise<Entry> {
  const db = getDb(); // throws "Vault is locked" if called without an unlocked session — never call outside a requireUnlocked-gated route
  const now = new Date().toISOString();
  const row = await db
    .insertInto("entries")
    .values({ id: crypto.randomUUID(), ...input, created_at: now, updated_at: now, deleted_at: null })
    .returningAll()
    .executeTakeFirstOrThrow();
  return row;
}
```

**Soft-delete pattern (D-04):**
```typescript
export async function softDeleteEntry(id: string): Promise<void> {
  const db = getDb();
  await db
    .updateTable("entries")
    .set({ deleted_at: new Date().toISOString() })
    .where("id", "=", id)
    .execute();
}
```
All "list" queries must add `.where("deleted_at", "is", null)` by default; trash view queries invert this (`.where("deleted_at", "is not", null)`).

**Tag many-to-many pattern (D-07, tags created on the fly):**
```typescript
export async function attachTags(entryId: string, tagNames: string[]): Promise<void> {
  const db = getDb();
  for (const name of tagNames) {
    const existing = await db.selectFrom("tags").selectAll().where("name", "=", name).executeTakeFirst();
    const tagId = existing?.id ?? (await db.insertInto("tags").values({ id: crypto.randomUUID(), name, created_at: new Date().toISOString() }).returningAll().executeTakeFirstOrThrow()).id;
    await db.insertInto("entry_tags").values({ entry_id: entryId, tag_id: tagId }).onConflict((oc) => oc.doNothing()).execute();
  }
}
```

---

### `server/src/modules/vault-entries/search.ts` (service, request-response/transform)

**Analog:** `server/src/modules/auth/totp.ts` — a module of pure/near-pure functions imported and called from `routes.ts`, not itself a router.

**Pattern:** Per CONTEXT.md's non-negotiable boundary, search must only query `entries.name`, `folders.name`, `tags.name`, and non-secret metadata — never the encrypted `payload` column contents. A simple `LIKE`-based query (left to Claude's discretion per D in CONTEXT.md) is the lowest-risk default given the small expected dataset (<200 entries per UI-SPEC's overflow note) and avoids introducing FTS5 virtual-table migration complexity in a stack with no migration runner:
```typescript
export async function searchEntries(query: string): Promise<EntrySummary[]> {
  const db = getDb();
  const like = `%${query}%`;
  return db
    .selectFrom("entries")
    .leftJoin("folders", "folders.id", "entries.folder_id")
    .selectAll("entries")
    .where("entries.deleted_at", "is", null)
    .where((eb) => eb.or([eb("entries.name", "like", like), eb("folders.name", "like", like)]))
    .execute();
}
```

---

### `server/src/modules/vault-entries/schemas.ts` (utility, validation)

**Analog:** inline Zod schemas in `server/src/modules/auth/routes.ts` (e.g. `initBodySchema` lines 68-71, `confirmEnrollmentBodySchema` lines 343-347)

**Pattern:** one `z.object` per entry type payload, discriminated union keyed on `type`, per D-01/D-02:
```typescript
const apiKeyPayloadSchema = z.object({ key: z.string(), endpoint: z.string().optional(), model: z.string().optional() });
const loginPayloadSchema = z.object({ username: z.string(), password: z.string(), url: z.string().optional() });
const notePayloadSchema = z.object({ body: z.string() });
const cardPayloadSchema = z.object({ number: z.string(), expiry: z.string(), cvv: z.string() });

export const entryCreateSchema = z.object({
  type: z.enum(["api_key", "login", "note", "card"]),
  name: z.string().min(1),
  folderId: z.string().nullable().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  payload: z.discriminatedUnion(... ) // or z.union keyed by `type` above
});
```
Pass through the existing `validate()` middleware (`server/src/middleware/validate.ts`) unchanged.

---

### `server/src/modules/vault-entries/*.test.ts` (test, request-response)

**Analog:** `server/src/modules/auth/unlock.test.ts`

**Harness pattern** (lines 1-51): fresh temp `VAULT_DIR` per test via `os.tmpdir()` + `randomBytes(8).toString("hex")`, `vi.resetModules()`, dynamic `import()` of `config.js`, the module under test, and `app.js`'s `startServer`, real HTTP requests against `http://${HOST}:${port}` — no mocking of Express or Kysely. Entry/folder/tag tests should additionally call `POST /api/vault/init` then `POST /api/vault/unlock` in a `beforeEach`-equivalent setup (since routes require `requireUnlocked`) before exercising entry CRUD endpoints.

---

### `client/src/lib/api.ts` (extend)

**Analog:** itself — existing `postJson<T>` helper (lines 48-58) and `ApiError` class (lines 21-29)

**Pattern to replicate per new endpoint:**
```typescript
export interface Entry { id: string; type: EntryType; name: string; folderId: string | null; /* ... */ }

export function listEntries(): Promise<Entry[]> {
  return fetch("/api/vault/entries").then(async (res) => {
    if (!res.ok) throw new ApiError(res.status, await parseErrorMessage(res));
    return res.json() as Promise<Entry[]>;
  });
}

export function createEntry(input: NewEntryInput): Promise<Entry> {
  return postJson<Entry>("/api/vault/entries", input);
}
```
Reuse `ApiError`/`parseErrorMessage`/`postJson` verbatim — do not duplicate fetch/error-parsing logic in feature components.

---

### `client/src/features/vault-entries/EntryForm.tsx` (component, form)

**Analog:** `client/src/features/vault-unlock/UnlockScreen.tsx`

**Form state + submit pattern** (lines 16-59):
```typescript
const [submitting, setSubmitting] = useState(false);
const [serverMessage, setServerMessage] = useState<string | null>(null);

async function handleSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  setSubmitting(true);
  setServerMessage(null);
  try {
    const entry = await createEntry(formValues);
    onSaved(entry);
  } catch (err) {
    setServerMessage(err instanceof ApiError ? err.message : "Couldn't save this entry. Check your connection and try again.");
  } finally {
    setSubmitting(false);
  }
}
```
UI-SPEC.md mandates this exact generic error copy on save failure and a `role="alert"` banner (matches `{serverMessage && <p role="alert">{serverMessage}</p>}` at line 97) — reuse verbatim, now styled with shadcn `Alert`/`Card` components instead of bare `<p>`/`<section>` tags (UI-SPEC's design system is new since Phase 1; markup structure carries over, presentation layer does not).

---

### `client/src/features/vault-entries/EntryDetail.tsx` (component, reveal/mask)

**Analog:** `client/src/features/vault-2fa/BackupCodesPanel.tsx` (reveal-once-then-hide precedent for secret display)

**Pattern:** per UI-SPEC's secret-reveal note, each secret field is masked by default with a per-field toggle and a 30s auto-re-mask timer — follow the same "session-scoped sensitive value, never persisted, cleared aggressively" posture `BackupCodesPanel.tsx` and `session.ts`'s idle-timer (`armIdleTimer`, lines 49-54) establish, using a local `useEffect`/`setTimeout` per revealed field rather than a shared global timer.

---

## Shared Patterns

### Auth/Session Gating
**Source:** `server/src/middleware/requireUnlocked.ts`
**Apply to:** every route in `vault-entries/routes.ts` (all of VAULT-01–05, ORG-01–03) — mount via `entriesRouter.use(requireUnlocked)` once, not per-route, matching how `2fa/*` routes each individually apply it (routes.ts lines 332, 362-366, 401-406, 425-430); a router-level `.use()` is cleaner here since *every* entry route needs it, unlike vaultRouter which has the one deliberate exception (`/status`).
```typescript
export function requireUnlocked(_req, res, next) {
  if (!isUnlocked()) { res.status(401).json({ error: "Vault is locked" }); return; }
  armIdleTimer();
  next();
}
```

### Request Validation
**Source:** `server/src/middleware/validate.ts`
**Apply to:** every POST/PUT route body (entry create/update, folder create/rename, tag attach, search query params if body-based)
```typescript
export function validate(schema: ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) { res.status(400).json({ error: "Invalid request" }); return; }
    req.body = result.data;
    next();
  };
}
```

### Async Route Error Handling
**Source:** `server/src/modules/auth/routes.ts` (repeated pattern, e.g. lines 73-183)
**Apply to:** every async route handler in `vault-entries/routes.ts`
```typescript
router.post("/x", validate(schema), (req, res, next) => {
  void (async () => {
    try {
      // ... work
      res.status(201).json(result);
    } catch (err) {
      next(err); // falls through to errorHandler.ts
    }
  })();
});
```

### Centralized Error Response Shape
**Source:** `server/src/middleware/errorHandler.ts`
**Apply to:** all vault-entries routes — register no new error handler; the existing `errorHandler` (mounted last in `app.ts`) already collapses everything to `{ error: "Unable to unlock" }` (401, VAULT_AUTH-tagged) or `{ error: "Internal error" }` (500). Entry CRUD errors that are NOT auth-related (e.g. not-found, validation) should be handled explicitly in the route with a specific status + `{ error: "..." }` shape (not routed through `vaultAuthError()`, which is reserved for the unlock oracle) — UI-SPEC's copy contract ("Couldn't save this entry...") expects a generic-but-not-auth-specific message surfaced client-side, not a new server error code.

### Client API Fetch Wrapper
**Source:** `client/src/lib/api.ts` (`postJson`, `ApiError`, `parseErrorMessage`)
**Apply to:** all new entry/folder/tag/search client functions — extend the same file, do not create a parallel fetch helper.

### Feature-Folder Convention
**Source:** `client/src/features/vault-unlock/`, `client/src/features/vault-2fa/`
**Apply to:** all new UI — `client/src/features/vault-entries/` holding `EntryListScreen.tsx`, `EntryForm.tsx`, `EntryDetail.tsx`, `FolderSidebar.tsx`, `TagFilter.tsx`, `SearchBar.tsx`, `TrashView.tsx`, `PasswordGenerator.tsx`. One component per concern, PascalCase filenames, default export per file — matches existing `UnlockScreen.tsx`/`TwoFactorSettings.tsx` convention exactly.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `client/src/features/vault-entries/PasswordGenerator.tsx` | component | client-side transform (CSPRNG) | No existing client-side-only generative UI in codebase; UI-SPEC.md's own spec (input-group + popover + slider + toggles) is the closest available reference — implement from UI-SPEC directly, using Web Crypto `crypto.getRandomValues` client-side, no server round-trip |
| `server/src/modules/vault-entries/search.ts` FTS5 variant | service | event-driven/batch (index maintenance) | No existing FTS5 usage in codebase; if planner opts for FTS5 over LIKE, there is no analog — plain `LIKE` (patterned above) is the lower-risk default given no existing precedent to copy |

## Metadata

**Analog search scope:** `server/src/modules/auth/`, `server/src/modules/db/`, `server/src/middleware/`, `client/src/features/vault-unlock/`, `client/src/features/vault-2fa/`, `client/src/lib/`
**Files scanned:** 17 (routes.ts, session.ts, vaultMeta.ts, totp.ts, crypto.ts, unlock.test.ts, schema.ts, connection.ts, requireUnlocked.ts, validate.ts, errorHandler.ts, rateLimit.ts, api.ts, session-signals.ts, UnlockScreen.tsx, InitScreen.tsx, BackupCodesPanel.tsx, TwoFactorSettings.tsx)
**Pattern extraction date:** 2026-08-19
