---
status: diagnosed
trigger: "Investigate issue: npm-dev-ctrlc-orphan-processes — `npm run dev` (via scripts/dev.mjs) does not cleanly kill its full process tree when Ctrl-C is pressed in an interactive Windows PowerShell terminal, despite the script's Windows-specific `taskkill /pid <pid> /T /F` tree-kill mitigation on SIGINT/SIGTERM."
created: 2026-08-19T00:00:00Z
updated: 2026-08-19T00:30:00Z
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

hypothesis: CONFIRMED (see Resolution) — the console-wide CTRL_C_EVENT broadcast to every process attached to the shared console (not just dev.mjs's direct children) is the root cause; dev.mjs's own SIGINT+taskkill mitigation only ever covers its own subtree and cannot reach the process layers above it (npm.cmd itself, npm's internal Windows script-runner shell) where the visible "Terminate batch job" prompt most plausibly originates.
test: static/code-level analysis of scripts/dev.mjs + package.json + confirmed via Node.js official child_process docs and a Node.js GitHub issue on --watch child-process behavior (live interactive repro not attempted per task instructions — static analysis was the required approach).
expecting: n/a — diagnose-only mode (goal: find_root_cause_only)
next_action: return ROOT CAUSE FOUND to caller; no fix applied in this session.

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: |
  Running `npm run dev` from an actual interactive terminal and pressing Ctrl-C once
  cleanly stops all three child processes (tsc --watch, node --watch server, vite client
  dev server) with no orphaned process left behind. This is also the explicit claim in
  scripts/dev.mjs's own header comment: "A single Ctrl-C (SIGINT) stops all three
  children with no orphaned process left behind."
actual: |
  User ran `npm run dev` in Windows PowerShell, pressed Ctrl-C once. A "Terminate batch
  job (Y/N)?" prompt appeared. The user's "y" keystroke was NOT consumed by that prompt —
  instead it landed at the next PowerShell prompt and PowerShell tried to run "y" as a
  command, erroring "y : The term 'y' is not recognized...". `Get-Process
  node,tsc,esbuild` shortly after showed two node.exe processes still running (PIDs 5280
  and 36264, generic C:\Program Files\nodejs\node.exe path, no cmdline captured).
errors: |
  PowerShell: "y : The term 'y' is not recognized as the name of a cmdlet, function,
  script file, or operable program..."
  CategoryInfo: ObjectNotFound: (y:String) [], CommandNotFoundException
  FullyQualifiedErrorId: CommandNotFoundException
reproduction: |
  Test 31 in .planning/phases/01-secure-vault-setup-unlock/01-UAT.md (gap G-01-31). Run
  `npm run dev` from repo root in interactive Windows PowerShell, let it boot fully, press
  Ctrl-C once, check for surviving node.exe processes a few seconds later. Live repro not
  performed in this session — investigation is static/code-level per task instructions.
started: "Discovered during Phase 01 human UAT, 2026-08-19."

## Eliminated
<!-- APPEND only - prevents re-investigating -->

- hypothesis: "dev.mjs's SIGINT handler never runs at all (parent process killed before userland code executes)."
  evidence: "Node's console-ctrl-handler-to-SIGINT translation on win32 is well-documented and reliable for the process that registers it (libuv installs a real console control handler via SetConsoleCtrlHandler). Nothing in dev.mjs or the surrounding process tree suggests dev.mjs itself is a batch file or otherwise incapable of running its handler — it is a plain `node <script>.mjs` invocation, not a `.cmd`. The prompt's known origin (a `.cmd`/batch-file process reacting to Ctrl-C) points at the cmd.exe layers in the tree, not at dev.mjs's own Node process failing to get scheduled. Ruled out as the primary explanation, though a race between dev.mjs's async (fire-and-forget, non-awaited) taskkill spawns and an ancestor cmd.exe tearing down the whole subtree first remains a plausible contributing timing factor (see Resolution).
  timestamp: 2026-08-19T00:15:00Z

- hypothesis: "taskkill /pid <pid> /T /F is fundamentally incapable of killing a cmd.exe-wrapped grandchild tree."
  evidence: "taskkill /T does walk the live process tree by PID/PPID at the moment it executes, and /F force-kills regardless of a process being blocked on a console read (so a cmd.exe stuck on 'Terminate batch job (Y/N)?' is not immune to it). The mechanism itself is sound for the subtree dev.mjs directly owns and can see (its 3 tracked children[] PIDs). It is not the primary cause of the *visible symptom* (the prompt + stray 'y'), because that prompt most plausibly originates from process layers ABOVE dev.mjs (npm.cmd itself, npm's internal Windows script-runner shell for running the 'dev' script) which dev.mjs never tracks and its taskkill calls never target. It remains a secondary, race-prone contributor to individual orphaned grandchildes further down the tree (see Resolution) but is not the root explanation for the reported prompt/stray-keystroke behavior.
  timestamp: 2026-08-19T00:20:00Z

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-08-19T00:05:00Z
  checked: "scripts/dev.mjs in full (all 124 lines)"
  found: |
    - isWindows children are spawned with `shell: isWindows` and default (non-detached,
      no CREATE_NEW_PROCESS_GROUP) process-group semantics for ALL THREE specs, including
      the "server" spec (`node --watch server/dist/src/app.js`) which does NOT use
      shell:true but still has no `detached`/new-process-group option set.
    - killTree() uses `spawn("taskkill", [...], { stdio: "ignore", shell: true })` —
      fire-and-forget, NOT awaited, no verification the taskkill actually completed or
      succeeded before the parent process itself may exit.
    - No `process.exit()` anywhere in the SIGINT/SIGTERM handlers or shutdownAll(); exit
      is expected to happen naturally once child handles close — but the initial
      `taskkill` spawn calls are themselves child handles that are never explicitly
      awaited/joined, only relied upon implicitly via Node's default keep-alive-until-no-
      active-handles behavior.
  implication: "The mitigation targets only dev.mjs's own direct children[] (3 PIDs: the tsc cmd.exe wrapper, the node --watch process, the client cmd.exe wrapper). It has no visibility into, and cannot kill, anything running ABOVE dev.mjs in the process tree (npm.cmd itself, npm's internal script-runner shell), nor anything BELOW a dead/reparented intermediate hop in its own subtree at the moment taskkill's snapshot is taken."

- timestamp: 2026-08-19T00:08:00Z
  checked: "package.json scripts.dev"
  found: "\"dev\": \"node scripts/dev.mjs\" — meaning `npm run dev` in PowerShell resolves `npm` to npm.cmd (a cmd.exe batch file) as the actual top-level process PowerShell spawns and attaches to its console. npm-cli.js (running under node, itself a child of npm.cmd) then runs the 'dev' script; npm's own Windows script-runner internally shells out via cmd.exe to invoke `node scripts/dev.mjs` (documented npm behavior for package.json script execution on win32 — npm uses a shell wrapper for run-script on Windows)."
  implication: "There are AT LEAST two additional cmd.exe/batch-file layers sitting ABOVE dev.mjs in the process tree that PowerShell/Windows directly attaches to the SAME console: (1) npm.cmd itself, and (2) npm's internal per-script shell wrapper. Both are, by definition, cmd.exe interpreting a batch/script invocation — exactly the condition under which cmd.exe intercepts Ctrl-C and shows 'Terminate batch job (Y/N)?'. dev.mjs's own SIGINT handler cannot run, or influence, code in either of these ancestor processes — they are entirely outside its process boundary."

- timestamp: 2026-08-19T00:12:00Z
  checked: "Node.js official child_process documentation (via web search, current docs)"
  found: "Direct quote (Node's own docs, Windows-specific caveat on `detached`): 'Without CREATE_NEW_PROCESS_GROUP, the only way to send an interrupt to a child process on Windows is to send Ctrl+C to all processes in the current console group, which would potentially include the current process and one or more parents that may not gracefully handle the interrupt.'"
  implication: "This is authoritative, primary-source confirmation of the core mechanism: on Windows, without explicitly creating a new process group (which dev.mjs does NOT do for any of its 3 children), Ctrl-C is a console-wide BROADCAST — delivered simultaneously and independently to every attached process, including ancestors ('one or more parents') of the process that registered a SIGINT handler. Node's own docs explicitly flag that such parents 'may not gracefully handle the interrupt' — precisely the failure mode being investigated (npm.cmd / npm's internal shell layer intercepting Ctrl-C on its own terms, independent of and uncoordinated with dev.mjs's userland SIGINT handler)."

- timestamp: 2026-08-19T00:14:00Z
  checked: "Node.js GitHub issue nodejs/node#59380 ('When using --watch, restarting the process does not kill child processes') and related watch-mode documentation (via web search)"
  found: "Node's `--watch` flag implementation runs the target script in a CHILD process supervised by an outer watcher process — confirmed as by-design behavior since --watch's introduction (Node 18.11+). The outer `node --watch server/dist/src/app.js` process dev.mjs spawns and tracks in children[] is itself a supervisor; the actual `server/dist/src/app.js` execution happens in a further, untracked grandchild node.exe process that dev.mjs's children[] array has no knowledge of."
  implication: "This independently explains why TWO generic-path node.exe survivors (not one) were observed: the 'server' spec alone can legitimately produce two node.exe processes (outer --watch supervisor + inner execution child), neither of which is guaranteed to be cleanly reaped if taskkill's tree-walk snapshot is taken after the outer supervisor has already been torn down/reparented by the SAME broadcast Ctrl-C reaching it directly (per the console-group finding above) before dev.mjs's own (unawaited, fire-and-forget) taskkill call executes."

- timestamp: 2026-08-19T00:16:00Z
  checked: "cmd.exe 'Terminate batch job (Y/N)?' behavior (established Windows console-host behavior, cross-referenced against known reports for concurrently/npm-run-all on Windows)"
  found: "This prompt is specific to cmd.exe intercepting Ctrl-C while executing a .bat/.cmd file (a 'batch job'), and is a longstanding, well-documented Windows console quirk (not something Node or dev.mjs can suppress from inside a plain node.exe process). Every layer in this tree that is a `.cmd` invocation (npm.cmd itself, npm's internal script-runner shell, and dev.mjs's own two `shell:true`-spawned npm children which each further resolve into `.cmd` shims like `tsc.cmd`/`vite.cmd`) is independently subject to this exact interception, because they are all attached to the same console per the CREATE_NEW_PROCESS_GROUP finding above."
  implication: "The single visible prompt the user saw is most plausibly emitted by the OUTERMOST cmd.exe layer (npm.cmd itself or npm's internal script-runner shell) since it is closest to / most directly exposed at the interactive console PowerShell owns — placing its origin entirely OUTSIDE dev.mjs's process boundary and therefore entirely outside the reach of dev.mjs's own SIGINT/taskkill mitigation, regardless of how correctly that mitigation is implemented for dev.mjs's own direct children."

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: |
  Two distinct, compounding causes (AND-gate: both conditions are simultaneously in play
  and jointly produce the full observed symptom set — the prompt/stray-'y' behavior AND
  the orphaned node.exe survivors are explained by different facets of the same underlying
  Windows console-group semantics):

  1. [environment/platform] Windows delivers CTRL_C_EVENT as a console-wide BROADCAST to
     EVERY process attached to the same console simultaneously and independently — this is
     confirmed by Node's own official child_process documentation, which explicitly warns
     that without CREATE_NEW_PROCESS_GROUP, Ctrl-C reaches "the current process and one or
     more parents that may not gracefully handle the interrupt." `npm run dev` in
     PowerShell is not just `dev.mjs` — it is a chain of at least 5 process layers, several
     of them cmd.exe batch-file invocations, ALL attached to the same console because
     NONE of them (not npm.cmd, not npm's internal Windows script-runner shell, not
     dev.mjs's own two `shell:true` children) are spawned with a new/detached process
     group. dev.mjs's SIGINT handler + `taskkill /T /F` mitigation only has visibility
     into and authority over its OWN direct children[] (3 PIDs) — it cannot run in, or
     affect, ANY ancestor process (npm.cmd itself, npm's internal script-runner shell)
     that sits ABOVE dev.mjs in the tree, and those ancestor cmd.exe layers are exactly
     where the visible "Terminate batch job (Y/N)?" prompt most plausibly originates,
     since npm ships as npm.cmd (a batch file) and npm's own Windows script-runner also
     shells out via cmd.exe. This is the direct explanation for the prompt appearing and
     for the user's "y" keystroke being consumed by a fresh PowerShell prompt instead: the
     keystroke queues in the console's shared input buffer, and by the time it is read,
     the specific cmd.exe process that posted the prompt has already been torn down
     (independently, via the same broadcast Ctrl-C, or via its own default un-handled-
     interrupt termination) — so the still-pending "y\r" is instead consumed by whichever
     process next reads that shared console input buffer, i.e. the freshly-returned
     interactive PowerShell prompt.

  2. [code — dev.mjs's own mitigation scope and race exposure] dev.mjs's taskkill-based
     tree-kill is real and partially effective for its own subtree, but is exposed to two
     gaps: (a) the "server" spec (`node --watch server/dist/src/app.js`) is spawned
     without `shell:true` but is STILL attached to the same console (no detached/new
     process group), and Node's own `--watch` implementation runs the watched script in an
     untracked grandchild node.exe process (confirmed via nodejs/node#59380) that
     dev.mjs's children[] array never records and that the broadcast Ctrl-C reaches
     directly and independently of dev.mjs's taskkill call; (b) the taskkill calls
     themselves are fire-and-forget (`spawn(...)`, not awaited, no exit-code check), so
     there is no guarantee they complete their tree-walk before an ancestor cmd.exe layer
     (per cause 1) tears down / reparents an intermediate process in dev.mjs's own subtree,
     which can cause taskkill's live-snapshot-based `/T` tree-walk to miss now-orphaned
     descendants.

  The two surviving generic-path node.exe processes (PIDs 5280, 36264) are most plausibly
  either (a) the outer `node --watch` supervisor plus its untracked inner execution child
  for the "server" spec (cause 2a), and/or (b) deeply-nested node.exe processes several
  `.cmd`-shim hops below the tsc/client cmd.exe wrappers that fell outside taskkill's
  tree-walk snapshot due to the race in cause 2b — Get-Process's generic path/no-cmdline
  output in the original report does not disambiguate between these candidates, and a live
  repro with `Get-CimInstance Win32_Process | Select ProcessId,ParentProcessId,CommandLine`
  (as suggested in the reproduction steps) would be needed to pin the exact surviving PIDs
  to a specific spec — this was not performed in this diagnose-only, static-analysis
  session per task instructions.

fix: ""
verification: ""
files_changed: []
