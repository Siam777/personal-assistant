// Pure, side-effect-free construction of the dev-stack child process specs.
//
// Importing this module starts nothing and touches no filesystem beyond the
// package-manifest reads inside resolvePackageBin (which only run when a
// caller actually invokes it). This is what lets server/src/dev-script.test.ts
// import it directly without spinning up any part of the dev stack.
//
// Entrypoint resolution strategy: resolve `<pkg>/package.json` via
// createRequire, then join its declared `bin` entry against the manifest's
// own directory. This is the *only* strategy that works uniformly for both
// packages this file cares about:
//   - `require.resolve("typescript/bin/tsc")` resolves fine (TypeScript's
//     package.json has no `exports` field, so deep specifiers are open).
//   - `require.resolve("vite/bin/vite.js")` throws
//     `ERR_PACKAGE_PATH_NOT_EXPORTED` (Vite's `exports` map does not list
//     anything under `./bin`).
// Resolving `<pkg>/package.json` (always exported by both) and reading its
// `bin` field sidesteps that asymmetry entirely.

import { createRequire } from "node:module";
import path from "node:path";

/**
 * Resolve the absolute path to a named executable's real JavaScript
 * entrypoint, bypassing any Windows script shim (.cmd/.bat) that npm would
 * otherwise place on PATH for it.
 *
 * @param {string} packageName
 * @param {string} binName
 * @param {string} fromUrl - `import.meta.url` of the calling module; anchors
 *   module resolution the same way `require` would from that file's location.
 * @returns {string} absolute path to the resolved bin entrypoint
 */
export function resolvePackageBin(packageName, binName, fromUrl) {
  const require = createRequire(fromUrl);

  let manifestPath;
  try {
    manifestPath = require.resolve(`${packageName}/package.json`);
  } catch {
    throw new Error(
      `resolvePackageBin: could not resolve "${packageName}/package.json" — is ${packageName} installed?`
    );
  }

  const manifest = require(manifestPath);
  const bin = manifest.bin;

  let binEntry;
  if (typeof bin === "string") {
    binEntry = bin;
  } else if (bin && typeof bin === "object") {
    binEntry = bin[binName];
  }

  if (!binEntry) {
    throw new Error(
      `resolvePackageBin: package "${packageName}" has no "${binName}" entry in its bin field`
    );
  }

  return path.resolve(path.dirname(manifestPath), binEntry);
}

// Mirrors PORT in server/src/config.ts and server.port in
// client/vite.config.ts. server/src/dev-script.test.ts asserts these stay in
// sync with both source files, so a drift here fails loudly instead of
// silently pointing the shutdown harness at the wrong ports.
export const DEV_PORTS = {
  server: 5174,
  client: 5173,
};

/**
 * The one-shot synchronous server compile that must finish before any
 * watcher starts (see scripts/dev.mjs's header comment for why).
 *
 * @param {{ rootDir: string, fromUrl: string }} opts
 */
export function buildInitialBuildSpec({ rootDir, fromUrl }) {
  const tscPath = resolvePackageBin("typescript", "tsc", fromUrl);
  return {
    cmd: process.execPath,
    args: [tscPath, "-p", "server/tsconfig.json"],
    options: {
      cwd: rootDir,
      shell: false,
    },
  };
}

/**
 * Builds the three dev-stack child specs: tsc --watch, the compiled server
 * under node --watch, and the Vite dev server — each invoked through its
 * real JS entrypoint under `node` directly, with no Windows script shim
 * anywhere in the command or argument vector.
 *
 * @param {{ platform: string, rootDir: string, fromUrl: string }} opts
 * @returns {{ name: string, cmd: string, args: string[], options: object }[]}
 */
export function buildDevSpecs({ platform, rootDir, fromUrl }) {
  const isWindows = platform === "win32";
  const tscPath = resolvePackageBin("typescript", "tsc", fromUrl);
  const vitePath = resolvePackageBin("vite", "vite", fromUrl);

  // `detached: true` on Windows makes the child the root of a brand-new
  // process group *and* detaches it from the parent's console. That is what
  // stops the console-wide Ctrl-C broadcast (Windows delivers Ctrl-C to
  // every process sharing a console at once, uncoordinated with any
  // userland handler) from ever reaching these children directly. Instead,
  // the child is killed exclusively by dev.mjs's own tree-kill (see
  // killTree in dev.mjs), so the tree is still intact and walkable when
  // that tree-kill runs. On macOS/Linux this flag stays false and nothing
  // about the existing SIGTERM-based shutdown changes — console process
  // groups do not have this failure mode on those platforms.
  const baseOptions = {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    detached: isWindows,
  };

  return [
    {
      name: "tsc",
      cmd: process.execPath,
      args: [tscPath, "-p", "server/tsconfig.json", "--watch", "--preserveWatchOutput"],
      options: { ...baseOptions, cwd: rootDir },
    },
    {
      name: "server",
      cmd: process.execPath,
      args: ["--watch", "server/dist/src/app.js"],
      options: { ...baseOptions, cwd: rootDir },
    },
    {
      name: "client",
      cmd: process.execPath,
      args: [vitePath],
      options: { ...baseOptions, cwd: path.join(rootDir, "client") },
    },
  ];
}
