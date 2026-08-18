import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildDevSpecs,
  buildInitialBuildSpec,
  DEV_PORTS,
  resolvePackageBin,
} from "../../scripts/dev-spec.mjs";

/**
 * Coverage for the shim-free, process-group-isolated dev-stack spawn layer
 * (gap G-01-31). These assertions are the direct, deterministic guard
 * against the Windows "Terminate batch job (Y/N)?" regression: any spec
 * whose `cmd` or `args` resolves through a Windows script shim (.cmd/.bat)
 * reintroduces the console-attached batch-file layer that broadcasts
 * Ctrl-C into dev.mjs's own subtree.
 */

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..");
const fromUrl = new URL("../../scripts/dev-spec.mjs", import.meta.url).href;

const SCRIPT_SHIM_EXTENSIONS = /\.(cmd|bat)(\W|$)/i;

function hasScriptShim(value: string): boolean {
  return SCRIPT_SHIM_EXTENSIONS.test(value);
}

describe("buildDevSpecs — win32", () => {
  const specs = buildDevSpecs({ platform: "win32", rootDir: repoRoot, fromUrl });

  it("builds exactly three specs (tsc, server, client)", () => {
    expect(specs.map((s) => s.name)).toEqual(["tsc", "server", "client"]);
  });

  it("every spec's cmd is the node executable itself", () => {
    for (const spec of specs) {
      expect(spec.cmd).toBe(process.execPath);
    }
  });

  it("every spec has shell disabled and is detached (own process group)", () => {
    for (const spec of specs) {
      expect(spec.options.shell).toBe(false);
      expect(spec.options.detached).toBe(true);
    }
  });

  it("no spec's cmd or args ever reference a Windows script shim", () => {
    for (const spec of specs) {
      expect(hasScriptShim(spec.cmd)).toBe(false);
      for (const arg of spec.args) {
        expect(hasScriptShim(arg)).toBe(false);
      }
    }
  });
});

describe("buildDevSpecs — non-Windows non-regression", () => {
  for (const platform of ["darwin", "linux"]) {
    it(`detached is false on ${platform}`, () => {
      const specs = buildDevSpecs({ platform, rootDir: repoRoot, fromUrl });
      for (const spec of specs) {
        expect(spec.options.detached).toBe(false);
        expect(spec.options.shell).toBe(false);
      }
    });
  }
});

describe("buildInitialBuildSpec", () => {
  it("uses the node executable with shell disabled", () => {
    const spec = buildInitialBuildSpec({ rootDir: repoRoot, fromUrl });
    expect(spec.cmd).toBe(process.execPath);
    expect(spec.options.shell).toBe(false);
  });
});

describe("resolvePackageBin", () => {
  it("resolves an existing file for the TypeScript compiler", () => {
    const tscPath = resolvePackageBin("typescript", "tsc", fromUrl);
    expect(existsSync(tscPath)).toBe(true);
  });

  it("resolves an existing file for Vite (its bin dir is not in its exports map)", () => {
    const vitePath = resolvePackageBin("vite", "vite", fromUrl);
    expect(existsSync(vitePath)).toBe(true);
  });
});

describe("drift guards", () => {
  it("client/package.json's dev script is still exactly \"vite\"", () => {
    const clientPkg = JSON.parse(
      readFileSync(path.join(repoRoot, "client", "package.json"), "utf-8")
    ) as { scripts?: Record<string, string> };
    expect(clientPkg.scripts?.dev).toBe("vite");
  });

  it("DEV_PORTS.server matches the PORT literal in server/src/config.ts", () => {
    const configSrc = readFileSync(path.join(repoRoot, "server", "src", "config.ts"), "utf-8");
    const match = configSrc.match(/export const PORT = (\d+);/);
    expect(match).not.toBeNull();
    expect(DEV_PORTS.server).toBe(Number(match?.[1]));
  });

  it("DEV_PORTS.client matches server.port in client/vite.config.ts", () => {
    const viteConfigSrc = readFileSync(
      path.join(repoRoot, "client", "vite.config.ts"),
      "utf-8"
    );
    const match = viteConfigSrc.match(/port:\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(DEV_PORTS.client).toBe(Number(match?.[1]));
  });
});
