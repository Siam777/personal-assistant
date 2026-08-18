import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Supply-chain gate (T-01-03). This stops a later `npm update` from
 * silently drifting the server/kysely pins onto a Node-22-only line, or
 * from introducing the namesquat-adjacent unscoped `zxcvbn-ts` package that
 * Task 1's package-legitimacy checkpoint explicitly rejected.
 */

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..");

function readPackageJson(relPath: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  const raw = readFileSync(path.join(repoRoot, relPath), "utf-8");
  return JSON.parse(raw) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

describe("dependency supply-chain pins", () => {
  const serverPkg = readPackageJson("server/package.json");
  const clientPkg = readPackageJson("client/package.json");

  it("pins better-sqlite3-multiple-ciphers to the ^12. range (Node-20 compatible line)", () => {
    const range = serverPkg.dependencies?.["better-sqlite3-multiple-ciphers"];
    expect(range).toBeDefined();
    expect(range).toMatch(/^\^12\./);
  });

  it("pins kysely to the ^0.28. range (Node-20 compatible line)", () => {
    const range = serverPkg.dependencies?.kysely;
    expect(range).toBeDefined();
    expect(range).toMatch(/^\^0\.28\./);
  });

  it("never allows the unscoped zxcvbn-ts package in either workspace", () => {
    for (const pkg of [serverPkg, clientPkg]) {
      expect(pkg.dependencies?.["zxcvbn-ts"]).toBeUndefined();
      expect(pkg.devDependencies?.["zxcvbn-ts"]).toBeUndefined();
    }
  });

  it("depends on the scoped @zxcvbn-ts/core package", () => {
    expect(serverPkg.dependencies?.["@zxcvbn-ts/core"]).toBeDefined();
  });
});
