import { describe, expect, it, vi, afterEach } from "vitest";
import { logInfo, logError } from "./log.js";

describe("log redaction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts a nested field named for a password", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logInfo("unlock attempt", { request: { password: "hunter2" } });

    const loggedFields = spy.mock.calls[0]?.[1] as {
      request: { password: string };
    };
    expect(loggedFields.request.password).toBe("[REDACTED]");
  });

  it("redacts a field named for a key", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logInfo("derived", { masterKey: "not-a-real-key" });

    const loggedFields = spy.mock.calls[0]?.[1] as { masterKey: string };
    expect(loggedFields.masterKey).toBe("[REDACTED]");
  });

  it("redacts a raw Buffer value under an innocuously named key", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("failed", { payload: Buffer.from("secret-bytes") });

    const loggedFields = spy.mock.calls[0]?.[1] as { payload: string };
    expect(loggedFields.payload).toBe("[REDACTED]");
  });

  it("leaves unrelated fields intact", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logInfo("status check", { userId: 42, route: "/api/vault/status" });

    const loggedFields = spy.mock.calls[0]?.[1] as {
      userId: number;
      route: string;
    };
    expect(loggedFields.userId).toBe(42);
    expect(loggedFields.route).toBe("/api/vault/status");
  });
});
