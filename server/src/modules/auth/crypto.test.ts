import { describe, expect, it } from "vitest";
import { deriveMasterKey, generateVaultKey, unwrapKey, wrapKey } from "./crypto.js";

describe("wrapKey / unwrapKey", () => {
  it("round trip recovers the exact plaintext Buffer", () => {
    const key = generateVaultKey();
    const plaintext = generateVaultKey();

    const wrapped = wrapKey(plaintext, key);
    const recovered = unwrapKey(wrapped, key);

    expect(recovered.equals(plaintext)).toBe(true);
  });

  it("throws when unwrapping with a different key", () => {
    const key = generateVaultKey();
    const wrongKey = generateVaultKey();
    const plaintext = generateVaultKey();

    const wrapped = wrapKey(plaintext, key);

    expect(() => unwrapKey(wrapped, wrongKey)).toThrow();
  });

  it("produces a fresh IV on every call, even for identical inputs", () => {
    const key = generateVaultKey();
    const plaintext = generateVaultKey();

    const first = wrapKey(plaintext, key);
    const second = wrapKey(plaintext, key);

    expect(first.ivB64).not.toBe(second.ivB64);
  });
});

describe("deriveMasterKey", () => {
  it("returns a 32-byte Buffer", async () => {
    const salt = Buffer.alloc(16, 9);
    const key = await deriveMasterKey("a reasonably strong test password", salt);
    expect(key.length).toBe(32);
  });

  it("is deterministic for a fixed password-and-salt pair", async () => {
    const salt = Buffer.alloc(16, 3);
    const first = await deriveMasterKey("a reasonably strong test password", salt);
    const second = await deriveMasterKey("a reasonably strong test password", salt);
    expect(first.equals(second)).toBe(true);
  });

  it("differs across salts for the same password", async () => {
    const saltA = Buffer.alloc(16, 1);
    const saltB = Buffer.alloc(16, 2);
    const keyA = await deriveMasterKey("a reasonably strong test password", saltA);
    const keyB = await deriveMasterKey("a reasonably strong test password", saltB);
    expect(keyA.equals(keyB)).toBe(false);
  });
});
