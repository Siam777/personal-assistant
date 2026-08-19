#!/usr/bin/env node
// Documented full-stack local run command: `npm run dev`.
//
// Spawns three child processes with node:child_process — no process-manager
// dependency is added, so the installed dependency set stays exactly what
// Task 1 (package-legitimacy gate) vetted:
//   1. tsc -p server/tsconfig.json --watch   (compiles server TS -> server/dist)
//   2. node --watch server/dist/src/app.js   (re-runs the compiled server on change)
//   3. vite                                  (Vite dev server, run from client/)
//
// server/tsconfig.json sets rootDir "." (the server/ directory itself, so both
// src/ and scripts/ compile under one tsconfig), which is why the compiled
// entrypoint lands at dist/src/app.js rather than dist/app.js.
//
// Each child's output is prefixed with its name. Every child is invoked
// through its real JavaScript entrypoint under `node` directly (see
// dev-spec.mjs) rather than through npm's Windows script shims, and on
// Windows each child is spawned into its own detached process group so the
// console-wide Ctrl-C broadcast never reaches it directly — only dev.mjs's
// own tree-kill does, and that tree-kill is now awaited to completion before
// dev.mjs exits. A single Ctrl-C (or Ctrl-Break, or typing `q`/`stop` and
// pressing Enter) stops all three children with no orphaned process left
// behind. Run `npm run verify:dev-shutdown` to prove this without a human.

import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { buildDevSpecs, buildInitialBuildSpec } from "./dev-spec.mjs";

const isWindows = process.platform === "win32";
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(thisDir, "..");

/** @type {{ name: string, child: import('node:child_process').ChildProcess }[]} */
const children = [];
let shuttingDown = false;

function prefix(name, chunk) {
  return chunk
    .toString()
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => `[${name}] ${line}`)
    .join("\n");
}

/**
 * Kills a tracked child (and, on Windows, its full descendant tree) and
 * resolves only once it is actually confirmed gone — never fire-and-forget.
 *
 * On Windows, `taskkill /T /F` walks and force-kills the whole process tree
 * rooted at the child's PID; exit code 128 means the PID was already gone,
 * which is success, not failure. The shell option is left off — taskkill is
 * a plain .exe and needs no shell, and passing the shell option now raises a
 * DEP0190 deprecation warning under this Node.
 *
 * Off Windows, the child is a direct process (not console-attached the same
 * way), so a plain SIGTERM is sufficient, same as before this rewrite.
 *
 * Either branch races against a 5-second timer so one wedged child cannot
 * hang the whole shutdown.
 *
 * @param {{ name: string, child: import('node:child_process').ChildProcess }} entry
 */
function killTree(entry) {
  const { name, child } = entry;

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      process.stdout.write(`[${name}] did not confirm shutdown within 5s, continuing\n`);
      resolve();
    }, 5000);

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    }

    if (child.pid === undefined) {
      finish();
      return;
    }

    if (isWindows) {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        shell: false,
      });
      killer.on("close", () => {
        // Every exit code is treated as done, including 128 (PID already
        // gone — that is success, not failure).
        finish();
      });
      killer.on("error", () => {
        finish();
      });
    } else {
      child.once("exit", () => finish());
      child.kill("SIGTERM");
    }
  });
}

async function shutdownAll(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`[dev] shutting down (${reason})…\n`);
  await Promise.allSettled(children.map((entry) => killTree(entry)));
  process.stdout.write("[dev] all child processes have stopped\n");
}

// Registered before the one-shot compile runs, so an interrupt during the
// compile is not a hole. Note: the synchronous compile below cannot itself
// be interrupted from userland once spawnSync has started — that window is
// accepted because nothing has been spawned yet at that point.
process.on("SIGINT", () => {
  shutdownAll("SIGINT").then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  shutdownAll("SIGTERM").then(() => process.exit(0));
});
// Ctrl-Break on Windows — genuinely useful there, cleans up the same way
// Ctrl-C does.
process.on("SIGBREAK", () => {
  shutdownAll("SIGBREAK").then(() => process.exit(0));
});

// Stdin control channel: typing `q` or `stop` and pressing Enter triggers
// the same shutdown path. This is a real convenience for anyone running the
// stack, and it is also what lets scripts/verify-dev-shutdown.mjs exercise
// the exact same shutdown path deterministically, from a plain child
// process, with no console-signal trickery.
process.stdin.unref();
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed === "q" || trimmed === "stop") {
    shutdownAll(`stdin "${trimmed}"`).then(() => process.exit(0));
  }
});

// On a truly fresh checkout `server/dist/` does not exist yet. Spawning
// `node --watch server/dist/src/app.js` and `tsc --watch` at the same time
// races: node's initial load fails with MODULE_NOT_FOUND before tsc's first
// compile lands, and that immediate exit is treated as fatal below, killing
// every other child before the stack ever comes up. A one-shot synchronous
// build here guarantees the entrypoint exists before `node --watch` starts.
process.stdout.write("[build] compiling server once before starting watchers…\n");
const buildSpec = buildInitialBuildSpec({ rootDir, fromUrl: import.meta.url });
const initialBuild = spawnSync(buildSpec.cmd, buildSpec.args, {
  ...buildSpec.options,
  stdio: "inherit",
});
if (initialBuild.error) {
  process.stderr.write(`[build] failed to launch initial compile: ${initialBuild.error.message}\n`);
  process.exit(1);
}
if (initialBuild.status !== 0) {
  process.stderr.write("[build] initial server compile failed — see output above\n");
  process.exit(initialBuild.status ?? 1);
}

process.stdout.write(
  "[dev] stack starting — stop with Ctrl-C, or by typing q (or stop) and pressing Enter\n"
);
process.stdout.write(
  "[dev] to verify a clean shutdown without a human, run: npm run verify:dev-shutdown\n"
);

const specs = buildDevSpecs({ platform: process.platform, rootDir, fromUrl: import.meta.url });

for (const spec of specs) {
  const child = spawn(spec.cmd, spec.args, spec.options);

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(prefix(spec.name, chunk) + "\n");
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(prefix(spec.name, chunk) + "\n");
  });
  child.on("exit", (code) => {
    if (!shuttingDown) {
      process.stdout.write(`[${spec.name}] exited with code ${code}, stopping the rest\n`);
      shutdownAll(`${spec.name} exited`).then(() => {
        process.exitCode = code ?? 1;
        process.exit(process.exitCode);
      });
    }
  });
  // Without this, a spawn failure (ENOENT/EACCES/resource exhaustion) on
  // any child emits an unhandled "error" event and throws, killing dev.mjs
  // before shutdownAll ever runs and orphaning whichever siblings already
  // started — the same class of leak this script exists to prevent, just
  // triggered by a spawn failure instead of Ctrl-C.
  child.on("error", (err) => {
    if (!shuttingDown) {
      process.stderr.write(`[${spec.name}] failed to start: ${err.message}\n`);
      shutdownAll(`${spec.name} failed to start`).then(() => {
        process.exitCode = 1;
        process.exit(1);
      });
    }
  });

  children.push({ name: spec.name, child });
}
