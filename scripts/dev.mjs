#!/usr/bin/env node
// Documented full-stack local run command: `npm run dev`.
//
// Spawns three child processes with node:child_process — no process-manager
// dependency is added, so the installed dependency set stays exactly what
// Task 1 (package-legitimacy gate) vetted:
//   1. tsc -p server/tsconfig.json --watch   (compiles server TS -> server/dist)
//   2. node --watch server/dist/src/app.js   (re-runs the compiled server on change)
//   3. npm --workspace client run dev        (Vite dev server)
//
// server/tsconfig.json sets rootDir "." (the server/ directory itself, so both
// src/ and scripts/ compile under one tsconfig), which is why the compiled
// entrypoint lands at dist/src/app.js rather than dist/app.js.
//
// Each child's output is prefixed with its name. A single Ctrl-C (SIGINT)
// stops all three children with no orphaned process left behind.

import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";

/** @type {{ name: string, cmd: string, args: string[] }[]} */
const specs = [
  { name: "tsc", cmd: npmCmd, args: ["exec", "--", "tsc", "-p", "server/tsconfig.json", "--watch"] },
  { name: "server", cmd: "node", args: ["--watch", "server/dist/src/app.js"] },
  { name: "client", cmd: npmCmd, args: ["--workspace", "client", "run", "dev"] },
];

/** @type {import('node:child_process').ChildProcess[]} */
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
 * Kills a child process and, on Windows, its full descendant tree.
 *
 * On Windows the children below are launched with shell:true (npm.cmd
 * requires it — see below), which makes the direct child a cmd.exe wrapper
 * whose own child (node.exe / tsc) is a grandchild of this process.
 * `child.kill()` only signals the immediate child; cmd.exe does not
 * reliably forward that to its grandchild, which is exactly how a Ctrl-C
 * leaves an orphaned node/tsc process running. `taskkill /T /F` kills the
 * whole process tree rooted at the child's PID instead.
 */
function killTree(child) {
  if (isWindows && child.pid !== undefined) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      shell: true,
    });
  } else {
    child.kill("SIGTERM");
  }
}

function shutdownAll() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      killTree(child);
    }
  }
}

for (const spec of specs) {
  // On Windows, npm ships as npm.cmd — node:child_process.spawn cannot exec
  // a .cmd file directly without shell:true (throws EINVAL). All args below
  // are hardcoded constants, never user input, so shell:true carries no
  // injection risk here.
  const child = spawn(spec.cmd, spec.args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWindows,
  });

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(prefix(spec.name, chunk) + "\n");
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(prefix(spec.name, chunk) + "\n");
  });
  child.on("exit", (code) => {
    if (!shuttingDown) {
      process.stdout.write(`[${spec.name}] exited with code ${code}, stopping the rest\n`);
      shutdownAll();
      process.exitCode = code ?? 1;
    }
  });

  children.push(child);
}

process.on("SIGINT", () => {
  shutdownAll();
});
process.on("SIGTERM", () => {
  shutdownAll();
});
