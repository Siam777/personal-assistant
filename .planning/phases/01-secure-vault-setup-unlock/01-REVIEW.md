---
phase: 01-secure-vault-setup-unlock
reviewed: 2026-08-19T12:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - scripts/dev-spec.mjs
  - scripts/dev-spec.d.mts
  - scripts/dev.mjs
  - scripts/verify-dev-shutdown.mjs
  - server/src/dev-script.test.ts
  - package.json
  - README.md
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
fixed:
  - id: CR-01
    commit: f48222e
  - id: WR-02
    commit: f48222e
---

# Phase 01: Code Review Report

**Reviewed:** 2026-08-19T12:00:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found (CR-01 and WR-02 fixed same-session in commit f48222e — see note below; WR-01 and WR-03 remain open as non-blocking follow-ups)

**Scope note:** This review covers only Plan 01-05's gap-closure change set (the Windows
Ctrl-C orphaned-process fix that rebuilt `scripts/dev.mjs`'s spawn/shutdown layer and added
`scripts/dev-spec.mjs`, `scripts/dev-spec.d.mts`, `scripts/verify-dev-shutdown.mjs`,
`server/src/dev-script.test.ts`, and `README.md`). It is **not** a full-phase re-review — the
rest of Phase 01 (Plans 01-01 through 01-04) was already reviewed and fixed in a prior wave
(see `01-REVIEW-FIX.md` and git history for that earlier `01-REVIEW.md`), which this file
overwrites per the task's instructions.

## Summary

The rewritten spawn/shutdown layer is a solid, well-documented fix for the reported Windows
Ctrl-C/orphan-process bug: shim-free entrypoint resolution, Windows-only process-group
detachment, an awaited `taskkill /T /F` tree-kill treating exit code 128 as success, a stdin
control channel, and an automated shutdown-and-reap harness are all implemented consistently
with the plan and its verified environment facts. The drift guards in
`server/src/dev-script.test.ts` (port literals, `client/package.json`'s `dev` script) were
verified against the actual source files and are correct.

The main defect found is a real gap in the exact area this plan exists to harden: none of the
three dev-stack child spawns in `scripts/dev.mjs` register an `error` listener, so a spawn
failure on any child (even a transient one, e.g. resource exhaustion) throws an uncaught
exception that kills `dev.mjs` immediately — bypassing `shutdownAll` entirely and orphaning any
already-running sibling children, which is precisely the failure category (T-01-12) this plan
was written to eliminate. Three further quality/robustness issues were found in the shutdown
timing, error diagnostics, and duplicated security-relevant regex logic.

## Critical Issues

### CR-01: Spawned dev-stack children have no `error` listener — a spawn failure orphans already-running siblings

**File:** `scripts/dev.mjs:174-194`
**Issue:** The child-process spawn loop attaches `stdout`, `stderr`, and `exit` listeners but
never an `error` listener:

```js
for (const spec of specs) {
  const child = spawn(spec.cmd, spec.args, spec.options);

  child.stdout?.on("data", (chunk) => { ... });
  child.stderr?.on("data", (chunk) => { ... });
  child.on("exit", (code) => { ... });

  children.push({ name: spec.name, child });
}
```

`ChildProcess` extends `EventEmitter`; Node's default `EventEmitter` behavior is to **throw** an
uncaught exception when an `error` event is emitted with no registered listener. `spawn()` emits
`error` asynchronously whenever the underlying process could not be launched (e.g. `ENOENT`,
`EACCES`, or transient resource exhaustion such as `EMFILE`/`ENOMEM` under load). If this fires
for the second or third child (`server` or `client`) after the first child (`tsc`) is already
running, the resulting uncaught exception terminates `dev.mjs` immediately via Node's default
uncaught-exception path — which does **not** run `shutdownAll`, does **not** invoke `taskkill`,
and does not go through any of the registered `SIGINT`/`SIGTERM`/`SIGBREAK` handlers. On Windows
the already-spawned `tsc`/`server` children are detached into their own console-isolated process
groups specifically so they survive a console-wide Ctrl-C broadcast — which also means they
survive their parent's own crash with no supervisor left to reap them. This is the exact
orphaned-process failure mode (T-01-12: an orphaned `server/dist/src/app.js` process keeps an
unlocked vault session and its Vault Key buffer resident) that this plan was written to close,
now reachable via a different trigger (spawn failure) instead of Ctrl-C.

Contrast with `killTree`'s own `taskkill` spawn a few lines below, which correctly registers
both `close` and `error` handlers — the pattern is known and applied inconsistently.

**Fix:**
```js
for (const spec of specs) {
  const child = spawn(spec.cmd, spec.args, spec.options);

  child.on("error", (err) => {
    process.stderr.write(`[${spec.name}] failed to start: ${err.message}\n`);
    shutdownAll(`${spec.name} failed to start`).then(() => {
      process.exitCode = 1;
      process.exit(1);
    });
  });

  child.stdout?.on("data", (chunk) => { ... });
  child.stderr?.on("data", (chunk) => { ... });
  child.on("exit", (code) => { ... });

  children.push({ name: spec.name, child });
}
```

## Warnings

### WR-01: `killTree`'s POSIX branch wastes the full 5s timeout when the target child already exited

**File:** `scripts/dev.mjs:66-108` (specifically 103-106)
**Issue:** On the fail-fast path, the child whose own `exit` event triggered `shutdownAll` is
still present in the `children` array, so `killTree` is called on it too. On non-Windows:

```js
} else {
  child.once("exit", () => finish());
  child.kill("SIGTERM");
}
```

The `exit` event already fired *before* `shutdownAll` was invoked, so `.once("exit", ...)`
registered here will never fire again, and `child.kill("SIGTERM")` on an already-dead process is
a no-op. `finish()` is then only reached via the 5-second timer fallback, so every fail-fast
shutdown on macOS/Linux takes an unnecessary ~5 extra seconds for no functional reason. This
doesn't affect Windows (its `taskkill` branch resolves quickly against a dead PID via exit code
128) or the clean-shutdown paths (Ctrl-C/stdin), only the crash-triggered fail-fast path on
POSIX.

**Fix:**
```js
} else {
  if (child.exitCode !== null || child.signalCode !== null) {
    finish();
    return;
  }
  child.once("exit", () => finish());
  child.kill("SIGTERM");
}
```

### WR-02: Initial-build failure message discards the actual spawn error

**File:** `scripts/dev.mjs:156-163`
**Issue:**
```js
const initialBuild = spawnSync(buildSpec.cmd, buildSpec.args, {
  ...buildSpec.options,
  stdio: "inherit",
});
if (initialBuild.status !== 0) {
  process.stderr.write("[build] initial server compile failed — see output above\n");
  process.exit(initialBuild.status ?? 1);
}
```
`spawnSync` returns `status: null` and populates `.error` (not stdout/stderr) when the process
itself could not be launched (e.g. a corrupted install where the resolved `tsc` path doesn't
exist). In that case nothing was ever written to the inherited stdio, so "see output above" is
misleading, and the real diagnostic (`initialBuild.error.message`) is silently discarded —
turning a clear "tsc binary missing" signal into a confusing unexplained failure for whoever
debugs a broken install.

**Fix:**
```js
if (initialBuild.error) {
  process.stderr.write(`[build] failed to launch the initial compile: ${initialBuild.error.message}\n`);
  process.exit(1);
}
if (initialBuild.status !== 0) {
  process.stderr.write("[build] initial server compile failed — see output above\n");
  process.exit(initialBuild.status ?? 1);
}
```

### WR-03: Script-shim detection regex is duplicated instead of shared, risking silent drift in a security-relevant assertion

**File:** `scripts/verify-dev-shutdown.mjs:38`, `server/src/dev-script.test.ts:25`
**Issue:** The exact same pattern is hand-copied in two files rather than defined once and
imported:
```js
// scripts/verify-dev-shutdown.mjs
const SCRIPT_SHIM_RE = /\.(cmd|bat)(\W|$)/i;
// server/src/dev-script.test.ts
const SCRIPT_SHIM_EXTENSIONS = /\.(cmd|bat)(\W|$)/i;
```
This regex is the actual detection mechanism behind T-01-14's "no descendant references a script
shim" assertion in the harness and the equivalent unit-test assertion. Because the two copies
have no shared source, a future change to one (e.g. broadening it to also catch `.ps1` shims, or
narrowing it) will not automatically propagate to the other — the unit test could keep passing
against a definition the live harness no longer uses, or vice versa, with nothing to flag the
divergence.

**Fix:** Export a `hasScriptShim(value)` helper (or the regex itself) from `scripts/dev-spec.mjs`
and import it in both `scripts/verify-dev-shutdown.mjs` and
`server/src/dev-script.test.ts` instead of re-declaring the pattern in each.

## Info

### IN-01: `prefix()` can emit a stray blank line for whitespace-only output chunks

**File:** `scripts/dev.mjs:39-46, 177-181`
**Issue:** `prefix()` filters out empty lines and joins what remains with `"\n"`; if a stdout/
stderr chunk consists entirely of newlines/whitespace, the filtered array is empty and
`.join("\n")` returns `""`. The call site (`process.stdout.write(prefix(spec.name, chunk) +
"\n")`) then unconditionally appends a trailing newline regardless, writing a bare blank line to
the terminal with no `[name]` prefix. Purely cosmetic, but slightly undermines the "every line
prefixed with its name" contract the header comment describes.
**Fix:** Skip the write entirely when `prefix()` returns an empty string.

### IN-02: `resolvePackageBin`'s error paths are untested

**File:** `server/src/dev-script.test.ts` (whole file), `scripts/dev-spec.mjs:38-60`
**Issue:** `resolvePackageBin` has two distinct thrown-error branches (unresolvable package
manifest; manifest resolved but missing the requested `bin` entry), both with hand-written
messages that name the package. Neither is covered by a test, so a future refactor could silently
change or break these messages (which are the primary diagnostic for "why did `npm run dev` fail
to even start") without any test failing.
**Fix:** Add two small unit tests asserting the thrown error messages for a nonexistent package
name and for a real package with no matching `bin` entry (e.g. `resolvePackageBin("typescript",
"nonexistent-bin", fromUrl)`).

---

_Reviewed: 2026-08-19T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
