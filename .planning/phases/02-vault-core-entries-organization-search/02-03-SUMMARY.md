---
phase: 02-vault-core-entries-organization-search
plan: 03
subsystem: api+ui
tags: [express, kysely, sqlite, zod, react, vitest, shadcn]

requires:
  - phase: 02-vault-core-entries-organization-search
    plan: 01
    provides: entries/folders/tags/entry_tags schema, entriesRouter gated by requireUnlocked
  - phase: 02-vault-core-entries-organization-search
    plan: 02
    provides: full CRUD for all four entry types, generalized EntryForm, EntryDetail, EntryListScreen's loading/error/populated/selection states
provides:
  - Flat folder CRUD (folders.ts) with uncategorize-on-delete semantics run inside one transaction
  - Create-on-the-fly many-to-many tagging (tags.ts) — setEntryTags replaces an entry's links exactly and reuses existing tag rows by name
  - LIKE-based search filter composition (search.ts) over entries.name/folders.name/tags.name only, with escapeLikePattern guarding literal wildcards
  - GET/POST /folders, PATCH/DELETE /folders/:id, GET /tags, and q/folderId/tag query parameters on GET /entries
  - FolderSidebar, TagFilter, SearchBar client components; EntryListScreen promoted to the single filter-state owner and single listEntries caller
  - EntryForm folder Select and free-form tag chip input
affects: [02-04-PLAN.md]

actuals:
  tokens: 21140
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "applyEntryFilters(qb, filter) composes folder/tag/search predicates onto a Kysely query builder via $call — listEntries is the only caller, so folder/tag/search filters can never drift out of sync with each other"
    - "escapeLikePattern + an explicit LIKE ESCAPE clause on every free-text comparison, with all three values (entries.name, folders.name, tags.name) bound as Kysely parameters — no raw string ever reaches the query text"
    - "setEntryTags look-up-then-insert-then-replace-links inside one transaction — the tags table's own unique(name) constraint is the backstop, not the primary mechanism, for create-on-the-fly reuse"
    - "EntryListScreen as the single filter-state owner: query/selectedFolderId/activeTag all funnel through one listEntries(params) call in one effect; FolderSidebar and TagFilter own their own fetch/loading/error state independently and fail soft without blocking the entry list"

key-files:
  created:
    - server/src/modules/vault-entries/folders.ts
    - server/src/modules/vault-entries/tags.ts
    - server/src/modules/vault-entries/search.ts
    - server/src/modules/vault-entries/organization.test.ts
    - client/src/features/vault-entries/FolderSidebar.tsx
    - client/src/features/vault-entries/TagFilter.tsx
    - client/src/features/vault-entries/SearchBar.tsx
  modified:
    - server/src/modules/vault-entries/schemas.ts
    - server/src/modules/vault-entries/entries.ts
    - server/src/modules/vault-entries/routes.ts
    - client/src/lib/api.ts
    - client/src/features/vault-entries/EntryForm.tsx
    - client/src/features/vault-entries/EntryListScreen.tsx

key-decisions:
  - "Typed applyEntryFilters/search.ts's query builder against a hand-derived LeftJoinedSchema (folders columns wrapped in Kysely's own Nullable<T> shape) rather than VaultDbSchema directly — TypeScript's SelectQueryBuilder generic isn't structurally assignable across a leftJoin boundary otherwise, since Kysely marks every left-joined table's columns nullable in the query builder's DB type parameter"
  - "setEntryTags is full-replacement, not a merge: createEntry/updateEntry both call it with input.tags ?? [], so omitting tags on a PATCH clears them — matches the entryUpdateSchema's existing full-representation contract rather than adding partial-tag-patch semantics with no caller"
  - "A saved entry's folderName/tags are server-resolved values (folder name lookup, tag create-on-the-fly resolution) the client cannot correctly synthesize from the Entry DTO alone, so EntryListScreen's handleSaved now triggers the same single-fetch path a filter change would, rather than hand-splicing a partial summary into local state (02-02's approach, no longer sufficient once EntrySummary carries folderName/tags)"
  - "The truly-empty-vault state (zero entries, no active filter) keeps the full-page 'Your vault is empty' takeover from 02-01 rather than wrapping it in the sidebar/search layout — there is nothing yet to organize or search across"

requirements-completed: [ORG-01, ORG-02, ORG-03]

coverage:
  - id: D1
    description: "Flat folder CRUD end to end: assign entries to a folder, delete the folder and confirm its entries survive as uncategorized (not deleted), the folders table carries no parent/hierarchy column, and a duplicate folder name is rejected 409"
    requirement: ORG-01
    verification:
      - kind: integration
        ref: "server/src/modules/vault-entries/organization.test.ts#folder assignment: an entry created in a folder is returned by GET /entries?folderId="
        status: pass
      - kind: integration
        ref: "server/src/modules/vault-entries/organization.test.ts#folder delete uncategorizes its entries rather than deleting them"
        status: pass
      - kind: integration
        ref: "server/src/modules/vault-entries/organization.test.ts#folders are flat: the folders table has no column whose name contains 'parent'"
        status: pass
      - kind: integration
        ref: "server/src/modules/vault-entries/organization.test.ts#rejects a duplicate folder name with 409"
        status: pass
    human_judgment: false
  - id: D2
    description: "Tags are created on the fly and reused by name (never duplicated), filter the vault correctly, and a PATCH replaces an entry's tag links exactly"
    requirement: ORG-02
    verification:
      - kind: integration
        ref: "server/src/modules/vault-entries/organization.test.ts#creates a tag on the fly and reuses it by name across entries"
        status: pass
      - kind: integration
        ref: "server/src/modules/vault-entries/organization.test.ts#filters entries by tag"
        status: pass
      - kind: integration
        ref: "server/src/modules/vault-entries/organization.test.ts#replacing an entry's tags removes the old link and adds the new one"
        status: pass
    human_judgment: false
  - id: D3
    description: "Search finds an entry by name, folder name, or tag name; never collapses distinct entries with equal names; treats an empty/whitespace query as unfiltered; treats a bare SQL wildcard character literally; returns a deterministic order across repeated identical requests; composes folder+tag+q together; and never exposes a payload property on any entries/folders/tags collection response"
    requirement: ORG-03
    verification:
      - kind: integration
        ref: "server/src/modules/vault-entries/organization.test.ts#finds an entry by name, by its folder's name, and by one of its tag names"
        status: pass
      - kind: integration
        ref: "server/src/modules/vault-entries/organization.test.ts#returns both entries for an exact-name match and for a substring match, never collapsing them"
        status: pass
      - kind: integration
        ref: "server/src/modules/vault-entries/organization.test.ts#an empty or whitespace-only query returns the full unfiltered list"
        status: pass
      - kind: integration
        ref: "server/src/modules/vault-entries/organization.test.ts#treats a wildcard character in the search term literally, not as a SQL wildcard"
        status: pass
      - kind: integration
        ref: "server/src/modules/vault-entries/organization.test.ts#returns entries sharing an updated_at value in the same order across repeated identical requests"
        status: pass
      - kind: integration
        ref: "server/src/modules/vault-entries/organization.test.ts#composes folder, tag, and search filters together"
        status: pass
      - kind: integration
        ref: "server/src/modules/vault-entries/organization.test.ts#never includes a payload property on any element of the entries, folders, or tags collection responses"
        status: pass
      - kind: other
        ref: "! grep -Eq 'entries\\.payload' server/src/modules/vault-entries/search.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "UI: a user creates two folders and puts entries in each, confirms selecting a folder filters the list and 'All entries' clears it; adds a brand-new tag to an entry and confirms it appears as a chip and filters on click; deletes a folder and confirms its entries survive as Uncategorized; searches by name/folder/tag fragments and confirms the matched substring is bolded and typing does not fire a request on every keystroke; composes folder+tag+query together and confirms 'Clear filters' resets all three"
    verification: []
    human_judgment: true
    rationale: "Requires driving a real browser against the project's actual vault (master password + TOTP code), which this executor does not have access to by design — same constraint 02-01-SUMMARY.md's D4 and 02-02-SUMMARY.md's D5/D6 documented. workflow.human_verify_mode is end-of-phase, so this defers to a consolidated end-of-phase UAT pass rather than blocking mid-plan. Automated coverage (typecheck, lint, test:server 14/14 new + 102/102 total, build:client, all acceptance-criteria greps) is green."

duration: 65min
completed: 2026-08-19
status: complete
---

# Phase 2 Plan 3: Folders, Tags, and Search Summary

**Flat user-defined folders with uncategorize-on-delete, free-form create-on-the-fly tags, and a 300ms-debounced LIKE-based search that composes with folder/tag filters into one query — provably never reading the encrypted entry payload column.**

## Performance

- **Duration:** ~65 min
- **Completed:** 2026-08-19T22:22:49Z
- **Tasks:** 3
- **Files modified:** 13 (7 created, 6 modified)

## Accomplishments
- `folders.ts` (new): flat CRUD with no parent field/parameter anywhere in the module; `deleteFolder` nulls every referencing entry's `folder_id` inside one transaction before removing the folder row, so deleting a folder never deletes an entry; duplicate names surface as a tagged `DuplicateFolderNameError` the route converts to 409
- `tags.ts` (new): `setEntryTags` normalizes (trim, drop empty/duplicate) the submitted name list, reuses an existing tag row by name rather than duplicating it, and replaces an entry's `entry_tags` rows exactly inside one transaction; `tagsForEntries` batches tag-name lookups for a list of entries into one query
- `search.ts` (new): `applyEntryFilters` composes folder equality, an `exists` tag-membership subquery, and an `or` group of `LIKE`-with-explicit-ESCAPE comparisons over `entries.name`/`folders.name`/`tags.name` — the module never references the encrypted payload column, asserted by a source grep gate; `escapeLikePattern` neutralizes user-typed `%`/`_`/`\`
- `entries.ts`: `listEntries`/`getEntry` now attach `folderName`/`tags`; `createEntry`/`updateEntry` persist the `tags` field that has been part of the request contract since 02-01 without being written; ordering is `updated_at desc, id asc` for a deterministic order across identical repeated requests
- `routes.ts`: `GET`/`POST /folders`, `PATCH`/`DELETE /folders/:id`, `GET /tags`, and `q`/`folderId`/`tag`/`deleted` query parsing on `GET /entries` via `entryListQuerySchema`, all inheriting the router-level `requireUnlocked` gate
- `organization.test.ts` (new): 14 integration tests — folder assignment, uncategorize-on-delete, no-parent-column, duplicate-name 409, tag create-on-the-fly + reuse + filter + replacement, search by name/folder/tag, exact/substring adjacency, empty-query, literal-wildcard, deterministic ordering, three-way composition, and no-payload-in-any-collection-response
- `FolderSidebar.tsx` (new): "All entries" pseudo-folder (never deletable), create/rename/delete with the exact UI-SPEC confirmation copy, independent scroll past ~15 folders with truncate+title tooltip, own loading/empty/error states that never block the entry list from rendering
- `TagFilter.tsx` (new): renders nothing with zero tags or on fetch failure (fails soft), wraps chips rather than scrolling horizontally, "Show more"/"Show less" past eight visible chips
- `SearchBar.tsx` (new): 300ms-debounced controlled input, inline spinner swap while a search is in flight, clear control, no client-side max length
- `EntryForm.tsx`: added a folder `Select` (Uncategorized default, single-select per D-06) and a free-form tag chip input (Enter/comma commits, Backspace-on-empty removes the last chip, 44px remove-button touch target), both optional and non-blocking on submit
- `EntryListScreen.tsx`: promoted to the single owner of `query`/`selectedFolderId`/`activeTag` and the single `listEntries` caller; result-count header swaps to `"{N} results for "{query}""` with matched-substring bolding (string split, never `dangerouslySetInnerHTML`) while a query is active; "No matches" + "Clear filters" for any active filter with zero results; the exact search-failure copy renders below the input while previously-loaded entries stay visible; per-card chips show the real folder name and up to three tags plus a "+N" overflow chip

## Task Commits

Each task was committed atomically:

1. **Task 1: Flat folders, on-the-fly tags, and a search that never touches a secret** - `b2cbf2a` (feat)
2. **Task 2: The folder sidebar and the tag filter row** - `f3f0bc8` (feat)
3. **Task 3: Search, and one filtered query behind all three controls** - `1f57004` (feat)

**Plan metadata:** (this commit, follows)

## Files Created/Modified
- `server/src/modules/vault-entries/folders.ts` (new) - Flat folder CRUD, uncategorize-on-delete transaction
- `server/src/modules/vault-entries/tags.ts` (new) - Create-on-the-fly many-to-many tagging
- `server/src/modules/vault-entries/search.ts` (new) - Filter composition, LIKE-pattern escaping
- `server/src/modules/vault-entries/organization.test.ts` (new) - 14-test integration suite
- `server/src/modules/vault-entries/schemas.ts` - `folderCreateSchema`, `folderRenameSchema`, `entryListQuerySchema`
- `server/src/modules/vault-entries/entries.ts` - `listEntries`/`getEntry` carry `folderName`/`tags`; `createEntry`/`updateEntry` persist tags; deterministic ordering
- `server/src/modules/vault-entries/routes.ts` - Folder/tag routes, `GET /entries` query parsing
- `client/src/lib/api.ts` - `Folder`/`Tag` types, folder/tag CRUD functions, `EntryListParams`-driven `listEntries`
- `client/src/features/vault-entries/FolderSidebar.tsx` (new) - Flat folder navigation with create/rename/delete
- `client/src/features/vault-entries/TagFilter.tsx` (new) - Wrapping tag chip row with show-more
- `client/src/features/vault-entries/SearchBar.tsx` (new) - Debounced search input
- `client/src/features/vault-entries/EntryForm.tsx` - Folder select, tag chip input
- `client/src/features/vault-entries/EntryListScreen.tsx` - Single filter-state owner, search/highlight/empty/error states, per-card chips

## Decisions Made
- Typed `search.ts`'s query builder against a hand-derived `LeftJoinedSchema` (folders columns wrapped exactly as Kysely's own `Nullable<T>` does) rather than `VaultDbSchema` directly, after `SelectQueryBuilder<VaultDbSchema, "entries"|"folders", O>` failed to typecheck against the builder produced by an actual `.leftJoin("folders", ...)` call
- `setEntryTags` is full-replacement (matches the existing full-representation update contract): `createEntry`/`updateEntry` both call it with `input.tags ?? []`, so a PATCH omitting `tags` clears them, same semantics the rest of the entry update contract already has
- `EntryListScreen`'s `handleSaved` now triggers a refetch through the single fetch path rather than hand-splicing a partial `EntrySummary` into local state, since `folderName`/`tags` are server-resolved values the client cannot correctly synthesize from the `Entry` DTO alone
- The truly-empty-vault state (zero entries, no active filter) keeps the full-page "Your vault is empty" takeover from 02-01 rather than wrapping it in the sidebar/search layout — there is nothing yet to organize or search across

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `search.ts`'s own doc comment tripped its own acceptance-criteria grep**
- **Found during:** Task 1 self-check (acceptance criteria verification)
- **Issue:** The module doc comment explaining the encrypted-payload-column boundary contained the literal string `entries.payload`, tripping `! grep -Eq 'entries\.payload' search.ts` — the exact same failure mode 02-01-SUMMARY.md's deviation #2 and 02-02-SUMMARY.md's deviation #2 documented for a different literal
- **Fix:** Rephrased the comment to convey the same information without the literal substring
- **Files modified:** `server/src/modules/vault-entries/search.ts`
- **Verification:** `grep -Eq 'entries\.payload' server/src/modules/vault-entries/search.ts` now finds nothing; `npm run test:server` still green
- **Committed in:** `b2cbf2a` (Task 1 commit)

**2. [Rule 3 - Blocking] `applyEntryFilters`'s query-builder type didn't structurally match a real post-`leftJoin` builder**
- **Found during:** Task 1, `npm run typecheck`
- **Issue:** `SelectQueryBuilder<VaultDbSchema, "entries" | "folders", O>` is not assignable from the type TypeScript actually infers for `db.selectFrom("entries").leftJoin("folders", ...)`, because Kysely's `leftJoin` wraps the joined table's columns in its own `Nullable<T>` mapped type in the query builder's DB type parameter — `VaultDbSchema`'s `folders` interface has no such wrapping, so the two types are mutually non-assignable
- **Fix:** Defined `search.ts`'s internal `LeftJoinedSchema` type as `Omit<VaultDbSchema, "folders"> & { folders: { [K in keyof VaultDbSchema["folders"]]: VaultDbSchema["folders"][K] | null } }`, mirroring Kysely's own transform exactly, and typed `applyEntryFilters`/its internal `ExpressionBuilder` helper against that instead
- **Files modified:** `server/src/modules/vault-entries/search.ts`
- **Verification:** `npm run typecheck` passes clean for both workspaces
- **Committed in:** `b2cbf2a` (Task 1 commit)

**3. [Rule 1 - Bug] `EntrySummary`'s new required fields broke `EntryListScreen`'s hand-built summary object**
- **Found during:** Task 2, `npm run typecheck` (after extending the client `EntrySummary` type with `folderName`/`tags`)
- **Issue:** `EntryListScreen.tsx`'s `handleSaved` built an `EntrySummary` object literal from the saved `Entry` DTO with only the pre-Task-1 field set (`id`/`type`/`name`/`folderId`/`createdAt`/`updatedAt`), missing the now-required `folderName`/`tags` — and `folderName` in particular cannot be correctly derived client-side from the `Entry` DTO at all, since it is a server-side join result
- **Fix:** Replaced the hand-splice with a refetch through the same single fetch path a filter change already uses (`setRetryToken`), which is strictly more correct (it reflects the server's actual folder-name join) rather than attempting to patch the object literal with an incomplete/guessed value
- **Files modified:** `client/src/features/vault-entries/EntryListScreen.tsx`
- **Verification:** `npm run typecheck && npm run lint && npm run build:client` all pass; `handleDeleted` follows the same pattern for consistency
- **Committed in:** `f3f0bc8` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 self-inflicted acceptance-criteria grep miss — same recurring failure mode as both prior plans in this phase, 1 TypeScript blocking-issue fix from Kysely's join-nullability typing, 1 correctness fix following directly from this plan's own `EntrySummary` schema change)
**Impact on plan:** No scope creep — all three are within this plan's own declared files/acceptance criteria, or a direct, necessary consequence of a change this plan itself made.

## Issues Encountered

- **Recurring self-inflicted grep trip (now three plans in a row):** `search.ts`'s own explanatory doc comment tripped the exact acceptance-criteria grep it exists to satisfy, for the third time in this phase (02-01's `vaultAuthError` comment, 02-02's `deleteFrom` comment, now this plan's `entries.payload` comment). No code or test change needed beyond rewording — flagging the pattern in case a future phase wants a lint rule or authoring convention to catch this before typecheck/grep does.
- **Kysely's left-join nullability typing surfaced only at the exact `$call` boundary:** the mismatch between a hand-declared `SelectQueryBuilder<VaultDbSchema, ...>` type and the actual post-`leftJoin` builder type only appeared once `applyEntryFilters` was called through `$call` from `entries.ts` — resolved by mirroring Kysely's own `Nullable<T>` transform in a local type rather than fighting the generic inference. Noted here in case a future phase adds another left-joined filter-composition module and can reuse this pattern directly.
- **Prior WINDOWS.md ledger item resolved as a byproduct:** ledger entry #2 ("Unlocked branch renders a placeholder panel instead of the real vault entry view; Phase 2 delivers the real view") was still open even though 02-01 had already replaced the placeholder — this plan's completion (organize+search, the remainder of the phase's `<domain>` boundary) is what the entry's own description names as the resolving condition, so it was marked `fixed` via `gsd-tools windows fixed 2` as part of this plan's state updates rather than left stale.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Folders, tags, and search are fully wired end to end (server + client) for 02-04 (password generator + trash) to build on directly — no rework needed. `EntryListScreen`'s single-fetch-path architecture and `FolderSidebar`/`TagFilter`'s independent-refresh pattern are both reusable for a future trash view.
- ORG-01, ORG-02, and ORG-03 are fully delivered by this plan alone (verified against REQUIREMENTS.md's traceability table, which lists only Phase 2/this plan against all three IDs) — marked complete in REQUIREMENTS.md.
- **Open item for end-of-phase UAT:** live click-through of folder/tag/search filtering, composition, and the exact "Clear filters" reset behavior (coverage D4) has not been manually confirmed yet. Automated coverage (14/14 new integration tests, 102/102 total server tests, typecheck, lint, client build, all acceptance-criteria greps) is green.

---
*Phase: 02-vault-core-entries-organization-search*
*Completed: 2026-08-19*

## Self-Check: PASSED

All 13 files listed in Files Created/Modified (plus this SUMMARY.md) confirmed present on disk; all three task commit hashes (`b2cbf2a`, `f3f0bc8`, `1f57004`) confirmed present in git log.
