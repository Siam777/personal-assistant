---
phase: 01-secure-vault-setup-unlock
plan: 05
subsystem: infra
tags: [dev-tooling, windows, child_process, process-groups, vitest]

# Dependency graph
requires:
  - phase: 01-secure-vault-setup-unlock (plan 01-01)
    provides: scripts/dev.mjs and the root package.json dev/verify script slots this plan rebuilds
provides:
  - "Shim-free, process-group-isolated dev-stack spawn/shutdown layer (scripts/dev-spec.mjs, scripts/dev.mjs)"
  - "Automated shutdown-and-reap proof (scripts/verify-dev-shutdown.mjs, npm run verify:dev-shutdown)"
  - "Repository README documenting how to run and stop the dev stack"
  - "Closure of the last open Phase 01 UAT gap (G-01-31) and completion of SEC-04's cross-cutting promise"
affects: [dev-tooling, ci, onboarding]

actuals:
  tokens: 8100
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Resolve npm package bin entrypoints via <pkg>/package.json's bin field (not deep-specifier require.resolve, which throws ERR_PACKAGE_PATH_NOT_EXPORTED for exports-map packages like Vite) to invoke CLIs through node directly, bypassing Windows .cmd/.bat shims"
    - "Windows-only detached:true child spawn to isolate each dev-stack child into its own console-detached process group, immune to the console-wide Ctrl-C broadcast"
    - "Async, awaited tree-kill (taskkill /T /F, exit 128 treated as success) instead of fire-and-forget spawn"
    - "stdin control channel (q/stop) as a deterministic, non-console shutdown path usable by both humans and automated harnesses"

key-files:
  created:
    - scripts/dev-spec.mjs
    - scripts/dev-spec.d.mts
    - scripts/verify-dev-shutdown.mjs
    - server/src/dev-script.test.ts
    - README.md
  modified:
    - scripts/dev.mjs
    - package.json

key-decisions:
  - "Resolve TypeScript and Vite entrypoints via package.json bin fields (not require.resolve deep specifiers) — verified empirically that Vite's exports map throws ERR_PACKAGE_PATH_NOT_EXPORTED for any ./bin/* specifier, so bin-field resolution is the only strategy that works uniformly for both packages"
  - "Added a companion scripts/dev-spec.d.mts type declaration instead of enabling allowJs in server/tsconfig.json — allowJs pulled scripts/dev.mjs and scripts/verify-dev-shutdown.mjs into server's rootDir-constrained compilation and failed with TS6059 (file not under rootDir); the companion declaration types the cross-boundary import without touching tsconfig compiler options"
  - "verify-dev-shutdown.mjs drives shutdown through dev.mjs's own stdin control channel, not a simulated console signal — this makes the harness deterministic and portable, but it also means the harness cannot itself distinguish detached from non-detached children (confirmed by the Task 2 sensitivity check); the human checkpoint (Task 3) is what actually proves the console-broadcast fix"

patterns-established:
  - "Dev-tooling child processes: always resolve real JS entrypoints and spawn under node directly rather than depending on npm's Windows script shims"

requirements-completed: [SEC-01, SEC-04]

coverage:
  - id: D1
    description: "npx vitest run --root server dev-script passes: Windows spawn options (shell:false, detached:true, node executable), absence of any .cmd/.bat shim in any spec's cmd/args, non-Windows non-regression (detached:false on darwin/linux), Vite entrypoint resolution despite its restrictive exports map, and drift guards against client/package.json's dev script and the DEV_PORTS/config.ts/vite.config.ts port literals"
    requirement: SEC-04
    verification:
      - kind: unit
        ref: "server/src/dev-script.test.ts (12 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "npm run typecheck and npm run lint exit 0; npm run test:server passes all 66 tests across 10 files (54 pre-existing + 12 new) with zero regressions"
    verification:
      - kind: other
        ref: "npm run typecheck"
        status: pass
      - kind: other
        ref: "npm run lint"
        status: pass
      - kind: unit
        ref: "npm run test:server (66/66)"
        status: pass
    human_judgment: false
  - id: D3
    description: "npm run verify:dev-shutdown proves the whole dev-stack process tree is reaped on a shutdown request with no residue, twice back to back"
    requirement: SEC-04
    verification:
      - kind: e2e
        ref: "node scripts/verify-dev-shutdown.mjs (9/9 assertions, run twice)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A single real Ctrl-C in an interactive Windows PowerShell terminal cleanly stops the entire npm run dev / node scripts/dev.mjs process tree with no batch-job prompt and no orphaned process — UAT test 31 re-run"
    requirement: SEC-04
    verification:
      - kind: manual_procedural
        ref: "01-05-PLAN.md Task 3 checkpoint — all three rounds (npm run dev, node scripts/dev.mjs, q/Enter)"
        status: pass
    human_judgment: true
    rationale: "Windows console-wide Ctrl-C broadcast semantics can only be exercised from a real interactive terminal at a real keyboard; no automated harness or agent can trigger or observe the actual console signal delivery this gap concerns."

duration: 1h35m
completed: 2026-08-19
status: complete
---

# Phase 1 Plan 05: Windows dev-stack Ctrl-C shutdown gap closure Summary

**Rebuilt scripts/dev.mjs's spawn/shutdown layer to run every dev-stack child as a plain, process-group-isolated node process — eliminating the Windows "Terminate batch job" prompt and orphaned node.exe processes on Ctrl-C, proven by both an automated harness and a real interactive PowerShell re-test.**

## Performance

- **Duration:** 1h 35m
- **Started:** 2026-08-19T00:55:00Z
- **Completed:** 2026-08-19T02:30:00Z (approx, checkpoint pause included)
- **Tasks:** 3 (2 auto + 1 checkpoint:human-verify, approved)
- **Files modified:** 7 (5 created, 2 modified)

## Accomplishments

- `scripts/dev-spec.mjs` resolves the TypeScript and Vite CLI entrypoints via each package's `package.json` `bin` field (the only strategy that works for both — Vite's `exports` map throws `ERR_PACKAGE_PATH_NOT_EXPORTED` for any deep `./bin/*` specifier) and builds every dev-stack child spec with `shell: false` and, on Windows only, `detached: true` — putting each child in its own console-detached process group so the Windows console-wide Ctrl-C broadcast never reaches it directly.
- `scripts/dev.mjs`'s shutdown path is now fully async: `killTree` is awaited to completion (treating `taskkill` exit code 128 — "already gone" — as success) before `dev.mjs` itself exits, `SIGBREAK` is handled alongside `SIGINT`/`SIGTERM`, and a stdin control channel (`q`/`stop`) provides a deterministic, non-console shutdown path.
- `scripts/verify-dev-shutdown.mjs` + `npm run verify:dev-shutdown` prove the whole thing without a human: spawn the stack, wait for readiness, snapshot the full descendant process tree, assert no command interpreter or script shim exists anywhere in it, trigger a shutdown via stdin, and assert every recorded PID is gone and both ports are free. Ran clean twice back to back.
- `server/src/dev-script.test.ts` (12 tests) locks in the Windows spawn options, the shim-free guarantee, the non-Windows non-regression, and two drift guards (client's `dev` script staying `vite`, `DEV_PORTS` staying in sync with `server/src/config.ts` and `client/vite.config.ts`).
- `README.md` (new — the repository had none) documents both `npm run dev` and the direct `node scripts/dev.mjs` invocation, and explains the Windows-specific reason to prefer the direct one if Ctrl-C ever misbehaves.
- Human re-ran UAT test 31 in a real interactive PowerShell window across all three rounds (`npm run dev`, `node scripts/dev.mjs`, `q`+Enter) and confirmed clean results: no `Terminate batch job (Y/N)?` prompt, no leftover node/tsc/esbuild process, both ports released. Gap `G-01-31` is closed — Phase 01 UAT is now 35/35.

## Task Commits

Each task was committed atomically:

1. **Task 1: Rebuild dev.mjs's spawn and shutdown layer on shim-free, process-group-isolated children** - `56ae0fe` (feat)
2. **Task 2: Add the automated shutdown-and-reap harness, wire it to an npm script, and document the run commands** - `adabaa3` (feat)
3. **Task 3: Re-run UAT test 31 — a real single Ctrl-C in an interactive PowerShell window** - checkpoint:human-verify, approved by user (no code commit; verification-only task)

**Interim commit:** `6b16069` (docs: record checkpoint pause at Task 3, for session continuity)

**Plan metadata:** committed separately (this SUMMARY + UAT.md gap resolution)

## Files Created/Modified

- `scripts/dev-spec.mjs` - Pure spec builder: `resolvePackageBin`, `DEV_PORTS`, `buildInitialBuildSpec`, `buildDevSpecs`
- `scripts/dev-spec.d.mts` - Companion TypeScript declaration for the above, so `server/tsconfig.json`'s rootDir-constrained typecheck can type the cross-boundary import without `allowJs`
- `scripts/dev.mjs` - Spawn/shutdown layer rebuilt on `dev-spec.mjs`; async awaited `killTree`; `SIGBREAK` handling; stdin `q`/`stop` control channel
- `scripts/verify-dev-shutdown.mjs` - Standalone end-to-end shutdown-and-reap proof harness
- `server/src/dev-script.test.ts` - 12 unit tests covering spawn options, shim absence, non-Windows non-regression, entrypoint resolution, and drift guards
- `README.md` - New: project description, prerequisites, dev-stack run/stop instructions, shutdown verification, standard commands
- `package.json` - Added `verify:dev-shutdown` npm script

## Decisions Made

- Resolve TypeScript/Vite entrypoints via `package.json` `bin` fields rather than `require.resolve` deep specifiers — empirically verified this is the only strategy that works uniformly for both packages (Vite's `exports` map rejects any `./bin/*` deep specifier).
- Added a companion `scripts/dev-spec.d.mts` declaration file instead of enabling `allowJs` in `server/tsconfig.json` — `allowJs` pulled the sibling `scripts/*.mjs` files into server's `rootDir`-constrained compilation and failed with `TS6059` (file not under rootDir). The companion declaration types the cross-boundary import with zero tsconfig compiler-option changes.
- `verify-dev-shutdown.mjs` triggers shutdown through `dev.mjs`'s stdin control channel rather than attempting to simulate a console Ctrl-C signal — deterministic and portable, but it means the automated harness cannot itself distinguish `detached: true` from `detached: false` children (confirmed directly by the Task 2 sensitivity check, which passed 9/9 either way). This is exactly why Task 3's real-keyboard checkpoint exists and is not skippable.

## Deviations from Plan

None — plan executed exactly as written. The two implementation choices above (bin-field resolution for Vite, companion `.d.mts` over `allowJs`) were both already anticipated or directly specified by the plan's `<verified_environment_facts>` and `<action>` sections; the `.d.mts` file was the one concrete addition beyond the plan's explicit file list, added under Rule 3 (blocking issue — `npm run typecheck` failed with `TS6059`/`TS7016` without it) since the plan's acceptance criteria required `npm run typecheck` to exit 0 and the plan's own file list (`scripts/dev-spec.mjs`, `scripts/dev.mjs`, `server/src/dev-script.test.ts`) did not anticipate the rootDir conflict between a JSDoc-typed `.mjs` module and TypeScript's strict `rootDir` enforcement.

## Issues Encountered

- **`npm run typecheck` initially failed** importing `../../scripts/dev-spec.mjs` from `server/src/dev-script.test.ts`: without any JS-file type support, TypeScript reported implicit-`any` errors (`TS7016`/`TS7006`). Enabling `allowJs` in `server/tsconfig.json` fixed the implicit-`any` errors but introduced a new one: `TS6059`, because `allowJs` makes TypeScript include the imported `.mjs` file in the compiled program, and `scripts/dev-spec.mjs` sits outside `server/tsconfig.json`'s `rootDir: "."` (which is `server/`). Resolved by reverting the `allowJs` change and adding `scripts/dev-spec.d.mts` as a companion declaration file instead — TypeScript's Node16/nodenext module resolution prefers a co-located `.d.mts` over the `.mjs` implementation for type information, so the import now types cleanly with no `rootDir` conflict and no `allowJs` needed. `git diff server/tsconfig.json` confirmed a net no-op.
- **Sensitivity-check ambiguity (expected, not a defect):** flipping the Windows `detached` flag to `false` in `scripts/dev-spec.mjs` and re-running `npm run verify:dev-shutdown` still produced 9/9 passing assertions. This is because the harness's shutdown trigger is `dev.mjs`'s own stdin control channel (`stop`), which awaits `taskkill` regardless of whether the target child is console-detached — the harness never relies on the process surviving a real console signal broadcast to be reaped. The `detached` flag's actual protective value (immunity to the Windows console-wide Ctrl-C broadcast) is provably only testable from a real interactive terminal, which is exactly what Task 3's human checkpoint did. The flag was restored and `git diff` confirmed clean before committing Task 2.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 01 UAT is now 35/35 passing with both open gaps (`G-01-1`, `G-01-31`) resolved. `SEC-01` and `SEC-04` are both fully satisfied — `SEC-04` specifically required this plan, since a surviving dev-stack process after a believed-successful stop was a live counterexample to its "destroys the in-memory session key" promise (T-01-12 in the threat model).
- The dev-stack spawn/shutdown pattern established here (resolve real entrypoints, process-group-isolate on Windows, await every kill) is reusable for any future long-running dev tooling this project adds.
- No blockers for Phase 02.

## Self-Check: PASSED

All created files confirmed present on disk (`scripts/dev-spec.mjs`, `scripts/dev-spec.d.mts`,
`scripts/dev.mjs`, `scripts/verify-dev-shutdown.mjs`, `server/src/dev-script.test.ts`,
`README.md`, this SUMMARY). All commit hashes confirmed present in `git log`
(`56ae0fe`, `adabaa3`, `6b16069`, `ea42622`).

---
*Phase: 01-secure-vault-setup-unlock*
*Completed: 2026-08-19*
