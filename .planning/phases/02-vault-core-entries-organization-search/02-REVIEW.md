---
phase: 02-vault-core-entries-organization-search
reviewed: 2026-08-20T00:00:00Z
depth: standard
files_reviewed: 30
files_reviewed_list:
  - client/package.json
  - client/src/App.tsx
  - client/src/components/ui/popover.tsx
  - client/src/components/ui/skeleton.tsx
  - client/src/components/ui/slider.tsx
  - client/src/features/vault-entries/EntryDetail.tsx
  - client/src/features/vault-entries/EntryForm.tsx
  - client/src/features/vault-entries/EntryListScreen.tsx
  - client/src/features/vault-entries/FolderSidebar.tsx
  - client/src/features/vault-entries/PasswordGenerator.tsx
  - client/src/features/vault-entries/SearchBar.tsx
  - client/src/features/vault-entries/TagFilter.tsx
  - client/src/features/vault-entries/TrashView.tsx
  - client/src/lib/api.ts
  - package.json
  - server/src/app.ts
  - server/src/config.ts
  - server/src/modules/auth/routes.ts
  - server/src/modules/db/connection.ts
  - server/src/modules/db/schema.ts
  - server/src/modules/vault-entries/bootstrap.ts
  - server/src/modules/vault-entries/entries.test.ts
  - server/src/modules/vault-entries/entries.ts
  - server/src/modules/vault-entries/folders.ts
  - server/src/modules/vault-entries/organization.test.ts
  - server/src/modules/vault-entries/routes.ts
  - server/src/modules/vault-entries/schemas.ts
  - server/src/modules/vault-entries/search.ts
  - server/src/modules/vault-entries/tags.ts
  - server/src/modules/vault-entries/trash.test.ts
  - server/vitest.config.ts
findings:
  critical: 1
  warning: 5
  info: 3
  total: 9
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-08-20T00:00:00Z
**Depth:** standard
**Files Reviewed:** 30
**Status:** issues_found

## Summary

I reviewed the vault-entries module (entries/folders/tags/search/trash routes and services) plus the client UI that drives them, with particular attention to the two invariants called out by the reviewer prompt: (1) the encrypted `entries.payload` column must never be selected or filtered outside `getEntry`, and (2) every entry/folder/tag/search/trash route must be gated by `requireUnlocked`.

Both of those specific invariants hold. `search.ts`'s `applyEntryFilters` only ever touches `entries.name`, `folders.name`, and `tags.name`; `listEntries` explicitly enumerates its select list (no `payload`/`notes`); `getEntry` is the sole, well-documented exception that reads `payload`. On the auth-gating side, `entriesRouter.use(requireUnlocked)` is registered once at router level before any route is defined, and `app.ts` mounts `vaultRouter` (which owns `/status`, `/init`, `/unlock`, `/lock`, `/2fa/*`) ahead of `entriesRouter` at the same `/api/vault` prefix, so none of those public routes can be shadowed into the gated router and none of the entry/folder/tag routes can bypass the gate.

However, the review surfaced a genuine data-loss defect in the entry PATCH contract (the "full representation" invariant the code's own comments claim is true is not actually enforced by the Zod schema), plus several secondary robustness and quality issues in the tag-reuse logic, client error handling, and type-safety practices. Details below.

## Critical Issues

### CR-01: PATCH schema doesn't enforce the "full representation" contract it claims — omitting `tags`/`folderId`/`notes` silently wipes them

**File:** `server/src/modules/vault-entries/schemas.ts:89` (`export const entryUpdateSchema = entryCreateSchema;`), combined with `server/src/modules/vault-entries/entries.ts:222-238` (`updateEntry`)

**Issue:** `entries.ts`'s doc comment for `updateEntry` and `schemas.ts`'s doc comment for `entryUpdateSchema` both assert that "the client always submits every mutable field on PATCH" and that this is why the schema deliberately mirrors `entryCreateSchema` rather than making every field optional. But `entryCreateSchema` itself defines `folderId`, `notes`, and `tags` as optional (`commonEntryFields`, `schemas.ts:45-53`) — nothing in the schema actually *requires* those fields to be present on a PATCH request. `updateEntry` then applies destructive defaults when a field is absent:

```ts
// entries.ts:224-235
.set({
  name: input.name,
  folder_id: input.folderId ?? null,   // absent folderId -> uncategorizes the entry
  notes: input.notes ?? null,          // absent notes -> clears notes
  payload: JSON.stringify(input.payload),
  updated_at: now,
})
...
await setEntryTags(id, input.tags ?? []); // absent tags -> deletes every tag link
```

Any caller that sends a PATCH body without `tags` (e.g. `{ type, name, payload }`) passes validation cleanly and silently strips every tag from the entry, uncategorizes it, and clears its notes — with no error, no confirmation, and no test coverage for this path (`entries.test.ts` and `organization.test.ts` only ever exercise PATCH bodies that include every field). This is a real data-loss risk baked into the public HTTP contract, not merely a theoretical one: the current `EntryForm.tsx` client happens to always send every field, but the schema provides no actual backstop if that ever changes, if a future client is added, or if the API is driven directly (curl, another local process, a bug in a future edit surface).

**Fix:** Make the PATCH contract actually match its documented "full representation" intent — require `folderId`, `notes`, and `tags` on `entryUpdateSchema` (even if `folderId`/`notes` remain nullable) instead of inheriting `.optional()` from `entryCreateSchema`, e.g.:

```ts
const commonUpdateFields = {
  ...commonEntryFields,
  folderId: z.string().nullable(),   // no longer optional
  notes: z.string().max(10000).nullable(),
  tags: z.array(z.string().min(1).max(50)),
};
export const entryUpdateSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("api_key"), payload: apiKeyPayloadSchema, ...commonUpdateFields }),
  // ...repeat per type
]);
```
This makes an incomplete PATCH fail validation with a 400 instead of silently discarding state.

## Warnings

### WR-01: Case-sensitive tag matching undermines the documented "reuse tag by name" guarantee (D-07)

**File:** `server/src/modules/vault-entries/tags.ts:62-90`

**Issue:** The module doc comment (`tags.ts:1-8`) and `setEntryTags`'s doc comment both promise that "typing the same name again reuses the existing row rather than duplicating it." But the lookup is an exact, case-sensitive match:

```ts
const existing = await trx.selectFrom("tags").select("id").where("name", "=", name).executeTakeFirst();
```

A user who tags one entry `"Billing"` and later types `"billing"` on another entry gets a second, distinct tag row instead of reuse — fragmenting what the user perceives as one tag into two, each with its own (wrong) `entryCount` in `listTags()`/`TagFilter.tsx`.

**Fix:** Normalize case before the lookup/insert (e.g. compare against `lower(name)` in SQL, or store a normalized `name_lower` alongside the display name), or explicitly document that tag names are case-sensitive on the UI (tag input) so this isn't a silent surprise.

### WR-02: `setEntryTags` doesn't handle a unique-constraint race on new-tag creation, unlike `folders.ts`

**File:** `server/src/modules/vault-entries/tags.ts:73-79`

**Issue:** `createFolder`/`renameFolder` in `folders.ts` both explicitly catch a unique-constraint violation and convert it to `DuplicateFolderNameError` (`folders.ts:85-95`, `106-131`). `setEntryTags`'s create-on-the-fly insert has no equivalent handling:

```ts
const created = await trx
  .insertInto("tags")
  .values({ id: randomUUID(), name, created_at: new Date().toISOString() })
  .returning("id")
  .executeTakeFirstOrThrow();
```

If a unique-constraint violation is ever hit here (e.g. a `tags.name` collision from a request that races another write against the same connection between the `select` and `insert`), it throws an unhandled `SQLITE_CONSTRAINT_UNIQUE` error that falls through to the generic 500 handler, rather than being resolved to "reuse the existing tag" the way the module's own doc comment promises. This is the same class of hazard `folders.ts` already guards against; `tags.ts` should be symmetric.

**Fix:** Wrap the insert in the same `isUniqueConstraintError` pattern used in `folders.ts`, and on collision re-select the existing tag id instead of failing the whole `setEntryTags` call.

### WR-03: Several client mutation handlers have no error handling — failures are silent and leave stale UI state

**File:** `client/src/features/vault-entries/TrashView.tsx:81-100`, `client/src/features/vault-entries/FolderSidebar.tsx:97-101`, `client/src/features/vault-entries/EntryDetail.tsx:131-139`

**Issue:** `handleRestore`, `handleDeleteForever`, and `handleEmptyTrash` in `TrashView.tsx`, `handleDelete` in `FolderSidebar.tsx`, and `handleConfirmDelete` in `EntryDetail.tsx` all call a mutating API function with no `try/catch`:

```ts
// TrashView.tsx:81-85
async function handleRestore(id: string): Promise<void> {
  await restoreEntry(id);                 // throws -> unhandled rejection, no UI update, no error shown
  setEntries((current) => (current ? current.filter((entry) => entry.id !== id) : current));
  onRestored();
}
```
```ts
// EntryDetail.tsx:131-139
async function handleConfirmDelete(): Promise<void> {
  setDeleting(true);
  try {
    await deleteEntry(entryId);
    onDeleted();
  } finally {
    setDeleting(false);                   // no catch: on failure, dialog stays open with zero feedback
  }
}
```
On a network hiccup, a 404 (entry already permanently deleted elsewhere), or a 401 from an auto-lock racing the click, these calls reject, the promise rejection is unhandled (logged to console at best), the confirmation dialog/list never updates, and the user gets no indication anything went wrong — they're left clicking a button that silently does nothing.

**Fix:** Wrap each of these in `try/catch`, surface a visible error (toast, inline alert consistent with the rest of the file's error rows), and keep any "deleting"/"submitting" state accurate on failure.

### WR-04: `generatePassword` doesn't guard against `length < enabled class count`

**File:** `client/src/features/vault-entries/PasswordGenerator.tsx:71-95`

**Issue:** `generatePassword` seeds one character per enabled class first (`classes.map(...)`, up to 4 characters), then pads up to `options.length` with `while (result.length < options.length)`. If `options.length` is smaller than `classes.length`, the padding loop never runs and the function silently returns a password **longer** than requested instead of throwing or truncating. The current UI can't trigger this (the slider's `MIN_LENGTH` is 8, well above the max of 4 enabled classes), but `generatePassword` is exported and has no such precondition documented or enforced in its own contract — a future caller (or a future lower `MIN_LENGTH`) would get a silently-wrong-length password rather than an error.

**Fix:** Add an explicit guard: `if (options.length < classes.length) throw new Error(...)`, so the function's documented "exactly `options.length` characters" behavior is actually invariant rather than incidentally true today.

### WR-05: Redundant, unchecked `as EntryRow`/`as EntrySummaryRow` casts weaken compile-time protection against schema drift

**File:** `server/src/modules/vault-entries/entries.ts:145, 178, 197, 238, 279`

**Issue:** Every call site that turns a Kysely query result into a domain object re-asserts the row type with `as`, e.g.:

```ts
return rowToEntry(row as EntryRow, tagsByEntry.get(id) ?? []);   // getEntry, line 197
return rows.map((row) => rowToSummary(row as EntrySummaryRow, ...));  // listEntries, line 178
```
Because `EntryRow`/`EntrySummaryRow` are hand-written interfaces that duplicate (rather than derive from) `VaultDbSchema["entries"]` in `db/schema.ts`, and the cast is unchecked, a future column rename/type change in `schema.ts` would not be caught by the compiler here — the mismatch would only surface at runtime. Kysely already infers the correct row type from `.selectAll()` / `.select([...])`, so the cast is unnecessary and actively suppresses the type-checker's ability to catch drift.

**Fix:** Drop the `as` casts and let Kysely's inferred row types flow through, or derive `EntryRow`/`EntrySummaryRow` from `Selectable<VaultDbSchema["entries"]>` (via `Pick`/`Omit`) instead of hand-duplicating the field list.

## Info

### IN-01: `entryListQuerySchema.tag`/`folderId` have no length cap, unlike `q`

**File:** `server/src/modules/vault-entries/schemas.ts:117-123`

**Issue:** `q` is capped at `max(200)`, but `folderId` and `tag` are unconstrained `z.string()`. Since both are bound as query parameters (not interpolated into LIKE patterns), there's no injection risk, but an arbitrarily large query-string value for `tag`/`folderId` is accepted without limit, inconsistent with the rest of this schema's defensive posture.

**Fix:** Add a reasonable `.max(...)` to `folderId` and `tag` for consistency (e.g. `.max(200)`).

### IN-02: Folder create/rename failures are silently swallowed with no error UI

**File:** `client/src/features/vault-entries/FolderSidebar.tsx:70-95`

**Issue:** `handleCreateSubmit` and `handleRenameSubmit` both catch and discard every error (including a legitimate 409 duplicate-name conflict from the server) with only a comment explaining the intentional "leave the input open" fallback — the user gets no indication of *why* their folder wasn't created/renamed (e.g. name already taken vs. network failure).

**Fix:** At minimum, surface the server's error message (e.g. `ApiError.message`, which already carries "A folder with that name already exists" for the 409 case) near the inline input rather than swallowing it entirely.

### IN-03: No client-side automated test coverage for any Phase 2 UI component

**File:** `package.json:13` (`"test:client": "vitest run --root client --passWithNoTests"`)

**Issue:** `test:client` is configured to pass with zero tests, and indeed none of `EntryForm.tsx`, `EntryDetail.tsx`, `PasswordGenerator.tsx`, `TrashView.tsx`, `FolderSidebar.tsx`, `SearchBar.tsx`, or `TagFilter.tsx` have any test file. Security-relevant logic like `generatePassword`'s unbiased character sampling and class-guarantee behavior, and functional logic like the search debounce and per-field reveal timers, currently have no regression coverage — only the server-side HTTP round-trip tests exercise this phase's behavior indirectly.

**Fix:** Not a blocker for this review, but worth tracking: add unit tests at minimum for `generatePassword` (character-class distribution, length invariant, rejection-sampling correctness) given it's the one piece of client logic with a hard security property to preserve.

---

_Reviewed: 2026-08-20T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
