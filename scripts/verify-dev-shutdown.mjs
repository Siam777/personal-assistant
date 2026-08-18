#!/usr/bin/env node
// Automated, repeatable proof that a shutdown request reaps the entire
// `npm run dev` process tree, with no human at the keyboard. Answers one
// question with an exit code: does the dev.mjs stdin shutdown path
// (`stop`/`q`, the same path Ctrl-C now triggers on Windows via its own
// process-group-isolated tree-kill) actually kill every descendant and free
// both ports? See gap G-01-31 / UAT test 31 for the symptom this catches.
//
// Leaves the machine exactly as it found it, whether it passes or fails:
// port availability is checked up front, and a `finally` block force-kills
// every tracked descendant PID still alive on any exit path.
//
// This script prints command lines ONLY for processes inside the subject's
// own descendant tree. A machine-wide process enumeration necessarily
// returns command lines for unrelated processes too, and those can carry
// credentials, tokens, and paths that have nothing to do with this
// repository — everything outside the subject's tree exists here solely as
// parent-child index entries and is never printed or written anywhere
// (T-01-14). This script also never writes a report file — its output is
// the terminal, and its result is its exit code.

import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_PORTS } from "./dev-spec.mjs";

const isWindows = process.platform === "win32";
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(thisDir, "..");

const HOST = "127.0.0.1";
const READY_POLL_MS = 500;
const READY_TIMEOUT_MS = 180_000;
const REAP_WAIT_MS = 20_000;
const REAP_POLL_MS = 500;
const CMD_INTERPRETER_RE = /^cmd(\.exe)?$/i;
const SCRIPT_SHIM_RE = /\.(cmd|bat)(\W|$)/i;
const BATCH_JOB_PROMPT_RE = /Terminate batch job/i;

/** @type {{ pass: boolean, label: string }[]} */
const results = [];
function record(label, pass) {
  results.push({ label, pass });
  process.stdout.write(`[verify] ${pass ? "PASS" : "FAIL"} — ${label}\n`);
}

function tryBind(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, HOST, () => {
      server.close(() => resolve(true));
    });
  });
}

function tryConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port, timeout: 1000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enumerates every process on the machine and returns a flat list of
 * { pid, ppid, name, cmd }. Windows uses PowerShell + Get-CimInstance
 * (wmic is removed from current Windows builds); other platforms use `ps`.
 */
function listAllProcesses() {
  return new Promise((resolve, reject) => {
    if (isWindows) {
      const psScript =
        "Get-CimInstance Win32_Process | " +
        "Select-Object ProcessId,ParentProcessId,Name,CommandLine | " +
        "ConvertTo-Json -Compress";
      const ps = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", psScript], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
      let out = "";
      let err = "";
      ps.stdout.on("data", (d) => (out += d.toString()));
      ps.stderr.on("data", (d) => (err += d.toString()));
      ps.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`process enumeration failed (exit ${code}): ${err}`));
          return;
        }
        try {
          let parsed = JSON.parse(out || "[]");
          // PowerShell emits a bare object rather than an array when exactly
          // one row matches.
          if (!Array.isArray(parsed)) parsed = [parsed];
          resolve(
            parsed.map((row) => ({
              pid: row.ProcessId,
              ppid: row.ParentProcessId,
              name: row.Name ?? "",
              cmd: row.CommandLine ?? "",
            }))
          );
        } catch (e) {
          reject(new Error(`failed to parse process enumeration output: ${e.message}`));
        }
      });
    } else {
      const ps = spawn("ps", ["-eo", "pid=,ppid=,args="], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
      let out = "";
      ps.stdout.on("data", (d) => (out += d.toString()));
      ps.on("close", () => {
        const rows = out
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line) => {
            const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
            if (!match) return null;
            return { pid: Number(match[1]), ppid: Number(match[2]), name: match[3], cmd: match[3] };
          })
          .filter(Boolean);
        resolve(rows);
      });
    }
  });
}

/** Breadth-first collects every descendant of `rootPid` from a process list. */
function collectDescendants(allProcesses, rootPid) {
  const byParent = new Map();
  for (const p of allProcesses) {
    if (!byParent.has(p.ppid)) byParent.set(p.ppid, []);
    byParent.get(p.ppid).push(p);
  }
  const descendants = [];
  const queue = [rootPid];
  const seen = new Set();
  while (queue.length > 0) {
    const pid = queue.shift();
    const kids = byParent.get(pid) ?? [];
    for (const kid of kids) {
      if (seen.has(kid.pid)) continue;
      seen.add(kid.pid);
      descendants.push(kid);
      queue.push(kid.pid);
    }
  }
  return descendants;
}

function killPidTree(pid) {
  return new Promise((resolve) => {
    if (isWindows) {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        shell: false,
      });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
    } else {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
      resolve();
    }
  });
}

function isPidAlive(pid, allProcesses) {
  return allProcesses.some((p) => p.pid === pid);
}

async function main() {
  process.stdout.write("[verify] checking ports are free before starting…\n");
  const serverFree = await tryBind(DEV_PORTS.server);
  const clientFree = await tryBind(DEV_PORTS.client);
  if (!serverFree || !clientFree) {
    const occupied = [
      !serverFree ? `${DEV_PORTS.server} (server)` : null,
      !clientFree ? `${DEV_PORTS.client} (client)` : null,
    ].filter(Boolean);
    record(`ports free before start (occupied: ${occupied.join(", ")})`, false);
    printSummary();
    process.exit(1);
  }
  record("ports free before start", true);

  process.stdout.write("[verify] spawning scripts/dev.mjs…\n");
  const subject = spawn(process.execPath, [path.join(rootDir, "scripts", "dev.mjs")], {
    cwd: rootDir,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });

  let transcript = "";
  subject.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    transcript += text;
    process.stdout.write(`[subject] ${text}`);
  });
  subject.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    transcript += text;
    process.stderr.write(`[subject] ${text}`);
  });

  let subjectExited = false;
  let subjectExitCode = null;
  subject.on("exit", (code) => {
    subjectExited = true;
    subjectExitCode = code;
  });

  const cleanupPids = new Set();
  if (subject.pid !== undefined) cleanupPids.add(subject.pid);

  try {
    // Step 3: wait for readiness on both ports.
    process.stdout.write("[verify] waiting for the stack to become ready…\n");
    const readyDeadline = Date.now() + READY_TIMEOUT_MS;
    let ready = false;
    while (Date.now() < readyDeadline) {
      if (subjectExited) break;
      const [serverUp, clientUp] = await Promise.all([
        tryConnect(DEV_PORTS.server),
        tryConnect(DEV_PORTS.client),
      ]);
      if (serverUp && clientUp) {
        ready = true;
        break;
      }
      await sleep(READY_POLL_MS);
    }
    if (!ready) {
      process.stdout.write("[verify] --- transcript so far ---\n" + transcript + "\n--- end transcript ---\n");
      record("stack reached readiness within timeout", false);
      return;
    }
    record("stack reached readiness within timeout", true);

    // Step 4: snapshot the descendant tree.
    process.stdout.write("[verify] snapshotting descendant process tree…\n");
    const beforeAll = await listAllProcesses();
    const descendants = subject.pid !== undefined ? collectDescendants(beforeAll, subject.pid) : [];
    for (const d of descendants) cleanupPids.add(d.pid);

    // Step 5: tree hygiene assertions (Windows only).
    if (isWindows) {
      record(
        `descendant snapshot has at least 4 processes (found ${descendants.length})`,
        descendants.length >= 4
      );

      const interpreters = descendants.filter((d) => CMD_INTERPRETER_RE.test(d.name));
      if (interpreters.length > 0) {
        for (const d of interpreters) {
          process.stdout.write(`[verify]   offending: pid=${d.pid} name=${d.name} cmd=${d.cmd}\n`);
        }
      }
      record("no descendant is a command interpreter", interpreters.length === 0);

      const shims = descendants.filter((d) => SCRIPT_SHIM_RE.test(d.cmd ?? ""));
      if (shims.length > 0) {
        for (const d of shims) {
          process.stdout.write(`[verify]   offending: pid=${d.pid} name=${d.name} cmd=${d.cmd}\n`);
        }
      }
      record("no descendant references a script shim", shims.length === 0);
    } else {
      process.stdout.write("[verify] tree hygiene assertions are Windows-only; skipping on this platform\n");
    }

    // Step 6: trigger shutdown via the stdin control channel.
    process.stdout.write("[verify] triggering shutdown via stdin (\"stop\")…\n");
    subject.stdin.write("stop\n");
    subject.stdin.end();

    // Step 7: assert the reap.
    const exitDeadline = Date.now() + REAP_WAIT_MS;
    while (!subjectExited && Date.now() < exitDeadline) {
      await sleep(REAP_POLL_MS);
    }
    record("subject process exited within deadline", subjectExited);
    if (subjectExited) {
      process.stdout.write(`[verify] subject exit code: ${subjectExitCode}\n`);
    }

    const reapDeadline = Date.now() + REAP_WAIT_MS;
    let survivors = [];
    let portsFreeAfter = false;
    while (Date.now() < reapDeadline) {
      const afterAll = await listAllProcesses();
      survivors = descendants.filter((d) => isPidAlive(d.pid, afterAll));
      if (subject.pid !== undefined && isPidAlive(subject.pid, afterAll)) {
        survivors = [{ pid: subject.pid, name: "dev.mjs", cmd: "(subject)" }, ...survivors];
      }
      const [serverFreeAfter, clientFreeAfter] = await Promise.all([
        tryBind(DEV_PORTS.server),
        tryBind(DEV_PORTS.client),
      ]);
      portsFreeAfter = serverFreeAfter && clientFreeAfter;
      if (survivors.length === 0 && portsFreeAfter) break;
      await sleep(REAP_POLL_MS);
    }

    if (survivors.length > 0) {
      for (const s of survivors) {
        process.stdout.write(`[verify]   survivor: pid=${s.pid} name=${s.name} cmd=${s.cmd}\n`);
      }
    }
    record(`zero surviving PIDs (found ${survivors.length})`, survivors.length === 0);
    record("both ports free after shutdown", portsFreeAfter);

    // Step 8: transcript assertion.
    const hasBatchPrompt = BATCH_JOB_PROMPT_RE.test(transcript);
    record("transcript does not contain the batch-job confirmation prompt", !hasBatchPrompt);
  } finally {
    // Step 9: force-kill anything still alive, regardless of pass/fail.
    for (const pid of cleanupPids) {
      await killPidTree(pid);
    }
  }
}

function printSummary() {
  process.stdout.write("\n[verify] --- summary ---\n");
  for (const r of results) {
    process.stdout.write(`[verify] ${r.pass ? "PASS" : "FAIL"} — ${r.label}\n`);
  }
  const failed = results.filter((r) => !r.pass);
  process.stdout.write(`[verify] ${results.length - failed.length}/${results.length} assertions passed\n`);
}

main()
  .then(() => {
    printSummary();
    const allPassed = results.length > 0 && results.every((r) => r.pass);
    process.exit(allPassed ? 0 : 1);
  })
  .catch((err) => {
    process.stderr.write(`[verify] unexpected error: ${err.stack ?? err.message}\n`);
    printSummary();
    process.exit(1);
  });
