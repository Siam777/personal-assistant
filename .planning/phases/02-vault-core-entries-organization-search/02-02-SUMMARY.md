---
phase: 02-vault-core-entries-organization-search
plan: 02
subsystem: api+ui
tags: [express, kysely, sqlite, zod, react, vitest, shadcn]

requires:
  - phase: 02-vault-core-entries-organization-search
    plan: 01
    provides: entries/folders/tags/entry_tags schema, entryCreateSchema discriminated union, entriesRouter (GET/POST /entries) gated by requireUnlocked, EntryListScreen/EntryForm (api_key create+list only)
provides:
  - Full CRUD (create/view/edit/soft-delete) for every entry type (api_key, login, note, card) — server routes and service functions
  - EntryForm generalized into a type-picker + per-type-field-set form used for both create and edit
  - EntryDetail: masked-by-default secret reveal with independent per-field 30s auto re-mask
  - EntryListScreen: real loading/error/populated/partial/zero-one-many states, card selection wired to EntryDetail
affects: [02-03-PLAN.md, 02-04-PLAN.md]

actuals:
  tokens: 14013
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "entryUpdateSchema aliased directly to entryCreateSchema — identical discriminated-union shape, no duplicated branch definitions, since this is a full-representation update contract"
    - "Tagged EntryTypeImmutableError thrown by the service layer and caught at the route boundary, converted to a specific 400 — keeps the immutable-type business rule out of the generic error handler"
    - "Per-field reveal timers held in a Record<string, Timeout> ref plus a Set<string> of currently-revealed field names in state, both cleared in the fetch effect's cleanup so an entry change or unmount re-masks everything before the next render"
    - "EntryForm remounted via a `key` prop (editingEntry?.id ?? \"create\") when the container reopens it in a different mode/entry — resets all internal form state without hand-written reset logic"

key-files:
  created:
    - client/src/components/ui/skeleton.tsx
    - client/src/features/vault-entries/EntryDetail.tsx
  modified:
    - server/src/modules/vault-entries/schemas.ts
    - server/src/modules/vault-entries/entries.ts
    - server/src/modules/vault-entries/routes.ts
    - server/src/modules/vault-entries/entries.test.ts
    - client/src/lib/api.ts
    - client/src/features/vault-entries/EntryForm.tsx
    - client/src/features/vault-entries/EntryListScreen.tsx

key-decisions:
  - "Aliased entryUpdateSchema directly to entryCreateSchema rather than redeclaring an equivalent discriminated union — the plan's own description ('same four branches and same field shapes') is exactly satisfied by reuse, and it keeps the two contracts from silently drifting apart"
  - "Added `.trim()` to the entry `name` field's Zod validation (Rule 1/2 fix) — the schema's original `.min(1)` alone would have accepted a whitespace-only name, but the plan's own Task 1 edge case 8 requires a whitespace-only name to be rejected 400"
  - "Moved EntryForm's DialogHeader/DialogTitle inside the component itself instead of the container hardcoding a static title — the title now varies by type/step/edit-mode, which only the form itself knows at render time"
  - "EntryDetail's per-type secret field set only exercises the field names REQUIREMENTS.md/UI-SPEC.md name explicitly (api_key.key, login.password, note.body, card.number+cvv) — every other field renders in the clear, matching the 'only the field the user actually opens with a payload' scarcity a vault UI should have"

requirements-completed: [VAULT-01, VAULT-02, VAULT-03, VAULT-04]

coverage:
  - id: D1
    description: "Every entry type (api_key, login, note, card) can be fetched by id, updated in place, and soft-deleted through the API; type immutability and the soft-delete row-survival guarantee are proven by tests"
    requirement: VAULT-01
    verification:
      - kind: integration
        ref: "server/src/modules/vault-entries/entries.test.ts#round-trips a login/note/card entry through GET /entries/:id"
        status: pass
      - kind: integration
        ref: "server/src/modules/vault-entries/entries.test.ts#rejects a PATCH that changes the entry type, and leaves the stored entry unchanged"
        status: pass
      - kind: integration
        ref: "server/src/modules/vault-entries/entries.test.ts#soft delete: DELETE returns 204, GET then 404s, list omits it, row survives with deleted_at set"
        status: pass
    human_judgment: false
  - id: D2
    description: "Login and card entries are idempotent on create (duplicate bodies produce distinct rows) and durable under concurrency (20 concurrent creates all persist)"
    requirement: VAULT-02
    verification:
      - kind: integration
        ref: "server/src/modules/vault-entries/entries.test.ts#creating the same login/card entry twice produces two distinct rows"
        status: pass
      - kind: integration
        ref: "server/src/modules/vault-entries/entries.test.ts#ten concurrent login creates and ten concurrent card creates all persist"
        status: pass
    human_judgment: false
  - id: D3
    description: "A secure note round-trips unicode (emoji, CJK, combining diacritic) byte-identically through create and edit, and rejects a whitespace-only name"
    requirement: VAULT-03
    verification:
      - kind: integration
        ref: "server/src/modules/vault-entries/entries.test.ts#a note edited with unicode (emoji, CJK, combining diacritic) round-trips byte-identical"
        status: pass
      - kind: integration
        ref: "server/src/modules/vault-entries/entries.test.ts#rejects a blank (whitespace-only) name with 400"
        status: pass
    human_judgment: false
  - id: D4
    description: "PATCH is idempotent (identical body applied twice leaves exactly one row and advances updatedAt) across every entry type"
    requirement: VAULT-04
    verification:
      - kind: integration
        ref: "server/src/modules/vault-entries/entries.test.ts#PATCH twice with an identical body is idempotent and advances updatedAt"
        status: pass
    human_judgment: false
  - id: D5
    description: "UI: a user creates one entry of each of the four types via the generalized EntryForm, confirming each type shows only its own fields, Notes can be left blank, and a missing required field shows an inline message under that field"
    verification: []
    human_judgment: true
    rationale: "Requires driving a real browser against the user's actual vault (master password + TOTP code), which this executor does not have access to by design — same constraint 02-01-SUMMARY.md's D4 documented. workflow.human_verify_mode is end-of-phase, so this defers to a consolidated end-of-phase UAT pass rather than blocking mid-plan. Automated coverage (typecheck, lint, build:client, all acceptance-criteria greps) is green."
  - id: D6
    description: "UI: a user opens a login entry, reveals the password, confirms no other secret field reveals, waits 30s and confirms auto re-mask, reveals again and navigates away and back to confirm immediate re-mask, and confirms the exact 'Move to trash?' dialog copy"
    verification: []
    human_judgment: true
    rationale: "Same constraint as D5 — requires a live authenticated browser session this executor does not have. Deferred to end-of-phase UAT per workflow.human_verify_mode. The 30s timer, per-field Set<string> reveal state, effect-cleanup re-mask, and exact AlertDialog copy are all present in source and covered by the acceptance-criteria grep checks; only the live click-through timing/visual confirmation is deferred."

duration: 70min
completed: 2026-08-20
status: complete
---

# Phase 2 Plan 2: Full Entry CRUD, Generalized Form, and Secret-Reveal Detail View Summary

**Expanded the tracer's create+list-only, api_key-only vault into full create/view/edit/soft-delete for all four entry types, with one generalized form, a masked-secret-reveal detail view (independent per-field 30s auto re-mask), and real loading/error/selection states on the entry list.**

## Performance

- **Duration:** ~70 min
- **Tasks:** 3
- **Files modified:** 9 (2 created, 7 modified)

## Accomplishments
- `getEntry`/`updateEntry`/`softDeleteEntry` added to the entries service; `updateEntry` enforces entry-type immutability via a tagged `EntryTypeImmutableError` converted to 400 at the route boundary; `softDeleteEntry` never issues a hard delete
- `GET`/`PATCH`/`DELETE /api/vault/entries/:id` added to `entriesRouter`, all inheriting the router-level `requireUnlocked` gate
- `entries.test.ts` grew from 10 to 22 tests: per-type round-trip, login/card create-idempotency, 20-way mixed concurrency, PATCH idempotency, immutable-type rejection, unicode edit round-trip, blank-name rejection, soft-delete row survival, and not-found paths for all three id-scoped verbs
- `EntryForm.tsx` generalized from an api_key-only form into a type-picker (create mode) + per-type field-set form used for both create and edit, with per-field required-field validation on submit/blur and inline `role="alert"` messages
- `EntryDetail.tsx` (new): fetches one entry, renders every field with "Not set" placeholders for empty optionals, masks secret fields (`key`, `password`, `body`, `number`, `cvv`) behind an independent per-field 30s reveal timer, Edit and "Move to trash?" `AlertDialog` actions with exact UI-SPEC copy
- `EntryListScreen.tsx` extended with real loading (skeleton cards)/error (inline banner + Retry, stale-while-error)/populated/partial (`Uncategorized` badge)/zero-one-many (`{N} entries` counter only past one) states, per-type icons, and card selection wired to `EntryDetail`
- Added shadcn's official `skeleton` component (markup + Tailwind only, `client/package.json` dependency block confirmed unchanged)

## Task Commits

Each task was committed atomically:

1. **Task 1: Read-one, update, and soft-delete for every entry type** - `4ee6a97` (feat)
2. **Task 2: One form, four entry types** - `bb4488d` (feat)
3. **Task 3: The detail view — one secret at a time, and only for 30 seconds** - `bc9fbe9` (feat)

**Plan metadata:** (this commit, follows)

## Files Created/Modified
- `server/src/modules/vault-entries/schemas.ts` - `entryUpdateSchema` (aliased to `entryCreateSchema`), name field now trims before `.min(1)` validation
- `server/src/modules/vault-entries/entries.ts` - `getEntry`/`updateEntry`/`softDeleteEntry`, `EntryTypeImmutableError`
- `server/src/modules/vault-entries/routes.ts` - `GET`/`PATCH`/`DELETE /entries/:id`
- `server/src/modules/vault-entries/entries.test.ts` - 12 new tests (22 total)
- `client/src/lib/api.ts` - `getEntry`/`updateEntry`/`deleteEntry`
- `client/src/features/vault-entries/EntryForm.tsx` - generalized to a type-picker + per-type form, create and edit modes, per-field validation
- `client/src/features/vault-entries/EntryListScreen.tsx` - loading/error/populated/partial/zero-one-many states, selection, edit/delete wiring
- `client/src/features/vault-entries/EntryDetail.tsx` (new) - masked secret-reveal panel with Edit/Delete actions
- `client/src/components/ui/skeleton.tsx` (new) - shadcn official registry primitive

## Decisions Made
- Aliased `entryUpdateSchema` directly to `entryCreateSchema` — identical shape by construction, no drift risk between the two contracts
- Added `.trim()` to the `name` field's Zod validation so a whitespace-only name is rejected 400 (the plan's Task 1 edge case 8 required this; the pre-existing `.min(1)` alone did not reject whitespace-only strings)
- Moved `EntryForm`'s `DialogHeader`/`DialogTitle` inside the component (title now depends on type/step/edit-mode, which only the form knows) and dropped the now-redundant hardcoded header from `EntryListScreen`'s dialog wrapper
- `EntryForm` is remounted via a `key={editingEntry?.id ?? "create"}` prop when the container reopens it, resetting all internal state per session without hand-written reset logic

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Whitespace-only entry name was not rejected**
- **Found during:** Task 1, writing the "blank name rejected" test the plan requires
- **Issue:** `commonEntryFields.name` was `z.string().min(1).max(200)` — a whitespace-only string like `"   "` has length > 0, so it passed validation and would have been accepted, contradicting the plan's own required edge case ("create a note with a whitespace-only name and assert 400")
- **Fix:** Added `.trim()` before `.min(1)` so the trimmed value is what gets length-checked
- **Files modified:** `server/src/modules/vault-entries/schemas.ts`
- **Verification:** `entries.test.ts`'s "rejects a blank (whitespace-only) name with 400" test passes
- **Committed in:** `4ee6a97` (Task 1 commit)

**2. [Rule 1 - Bug] Doc-comment tripped its own `deleteFrom` acceptance-criteria grep**
- **Found during:** Task 1 self-check (same failure mode as 02-01's deviation #2)
- **Issue:** `softDeleteEntry`'s doc comment explaining it "never issues a `deleteFrom`" contained the literal string the acceptance criteria greps for, so `grep -Ec 'deleteFrom' entries.ts` returned 1 instead of the required 0
- **Fix:** Rephrased the comment to convey the same information without the literal identifier
- **Files modified:** `server/src/modules/vault-entries/entries.ts`
- **Verification:** `grep -Ec 'deleteFrom' entries.ts` now returns 0
- **Committed in:** `4ee6a97` (Task 1 commit)

**3. [Rule 3 - Blocking] `req.params.id` typed as `string | string[]` in the PATCH handler**
- **Found during:** Task 1, `npm run typecheck`
- **Issue:** TypeScript inferred `req.params.id` as `string | string[]` in the PATCH route (passing `validate(entryUpdateSchema)` as a second handler alongside the async arrow function appears to widen Express 5's route-literal param-type inference), rejecting the call to `updateEntry(req.params.id, ...)` which expects `string`
- **Fix:** Added an explicit `as string` cast on `req.params.id` in all three new `:id` routes (GET/PATCH/DELETE) for consistency, even though only PATCH's combination of handlers triggered the error
- **Files modified:** `server/src/modules/vault-entries/routes.ts`
- **Verification:** `npm run typecheck` passes clean
- **Committed in:** `4ee6a97` (Task 1 commit)

**4. [Rule 1 - Bug] `EntryListScreen`'s hardcoded dialog header became a duplicate once `EntryForm` grew its own**
- **Found during:** Task 2, immediately after generalizing `EntryForm` to render its own `DialogHeader`/`DialogTitle` (required since the title now varies by type/step/edit-mode)
- **Issue:** `EntryListScreen.tsx`'s `DialogContent` still hardcoded `<DialogHeader><DialogTitle>New API key entry</DialogTitle></DialogHeader>` above `<EntryForm />`, which would have rendered two stacked dialog headers
- **Fix:** Removed the hardcoded header and its now-unused imports from `EntryListScreen.tsx`; `EntryForm` owns its own header for both the type-picker and field steps
- **Files modified:** `client/src/features/vault-entries/EntryListScreen.tsx`
- **Verification:** `npm run typecheck && npm run lint && npm run build:client` all pass; visual duplication confirmed absent by reading the rendered JSX tree
- **Committed in:** `bb4488d` (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (1 correctness/spec-compliance fix, 1 self-inflicted acceptance-criteria grep miss, 1 TypeScript blocking-issue fix, 1 integration cleanup following this plan's own EntryForm redesign), all caught and corrected before their respective task commits
**Impact on plan:** No scope creep — all four are within the plan's own declared files/acceptance criteria, or a direct, necessary consequence of a change this plan itself made.

## Issues Encountered

- **Tracer-era dev-stack constraints still apply:** as documented in 02-01-SUMMARY.md, `scripts/dev.mjs` cannot run non-interactively in this sandbox (`process.stdin.unref()` throws on non-TTY stdin), and the project's real vault has 2FA enabled with credentials this executor does not hold. No live click-through was attempted this plan for the same reasons 02-01 deferred its D4 — recorded as coverage items D5/D6 above for end-of-phase UAT, consistent with `workflow.human_verify_mode: "end-of-phase"`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Full CRUD for all four entry types (server + client), the generalized `EntryForm`, and the masked-secret `EntryDetail` panel are all in place for 02-03 (folders/tags/search) and 02-04 (password generator + trash) to build on directly.
- **Open items for end-of-phase UAT:** live click-through of (1) creating one entry of each type via the generalized form and confirming per-type field isolation and inline validation (coverage D5), and (2) the secret-reveal/re-mask timing and exact trash-confirmation copy (coverage D6). Automated coverage (22/22 server integration tests, typecheck, lint, client build, all acceptance-criteria greps) is green.

---
*Phase: 02-vault-core-entries-organization-search*
*Completed: 2026-08-20*

## Self-Check: PASSED

All 9 files listed in Files Created/Modified (plus this SUMMARY.md) confirmed present on disk; all three task commit hashes (`4ee6a97`, `bb4488d`, `bc9fbe9`) confirmed present in git log.
