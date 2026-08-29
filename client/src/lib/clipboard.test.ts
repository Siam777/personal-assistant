import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard, clearClipboardImmediately } from "./clipboard";
import * as api from "./api";

describe("Clipboard & 30-Second Auto-Clear (TRUST-01, TRUST-02)", () => {
  let writeTextMock: ReturnType<typeof vi.fn>;
  let reportAuditEventSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    if (!globalThis.navigator) {
      (globalThis as unknown as { navigator: Record<string, unknown> }).navigator = {};
    }
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    reportAuditEventSpy = vi.spyOn(api, "reportAuditEvent").mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearClipboardImmediately();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("copies secret to clipboard with 1 action and reports audit event", async () => {
    const success = await copyToClipboard("sk-proj-super-secret-12345", {
      label: "API Key",
      entryId: "entry-abc",
      entryName: "OpenAI Key",
      entryType: "api_key",
      fieldName: "key",
      isSecret: true,
      clearAfterMs: 30_000,
    });

    expect(success).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith("sk-proj-super-secret-12345");

    // Verifies audit event was reported without secret string
    expect(reportAuditEventSpy).toHaveBeenCalledWith({
      eventType: "secret_copied",
      entryId: "entry-abc",
      entryName: "OpenAI Key",
      entryType: "api_key",
      fieldName: "key",
    });
    expect(JSON.stringify(reportAuditEventSpy.mock.calls)).not.toContain("sk-proj-super-secret-12345");
  });

  it("auto-clears clipboard after 30 seconds", async () => {
    await copyToClipboard("super-secret-password-123", {
      label: "Password",
      isSecret: true,
      clearAfterMs: 30_000,
    });

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith("super-secret-password-123");

    // Fast-forward 29 seconds (should not be cleared yet)
    vi.advanceTimersByTime(29_000);
    expect(writeTextMock).toHaveBeenCalledTimes(1);

    // Fast-forward another 1.1 seconds (30.1s total)
    await vi.advanceTimersByTimeAsync(1_100);
    expect(writeTextMock).toHaveBeenCalledTimes(2);
    expect(writeTextMock).toHaveBeenLastCalledWith("");
  });

  it("resets auto-clear timer if a new secret is copied before 30s expires", async () => {
    await copyToClipboard("secret-1", { clearAfterMs: 30_000, isSecret: true });
    expect(writeTextMock).toHaveBeenCalledWith("secret-1");

    // Advance 15 seconds
    vi.advanceTimersByTime(15_000);

    // Copy another secret
    await copyToClipboard("secret-2", { clearAfterMs: 30_000, isSecret: true });
    expect(writeTextMock).toHaveBeenCalledWith("secret-2");

    // Advance another 20 seconds (total 35s from first copy, 20s from second copy)
    vi.advanceTimersByTime(20_000);
    // Should NOT have cleared secret-2 yet
    expect(writeTextMock).toHaveBeenCalledTimes(2);

    // Advance 10.1 more seconds (30.1s from second copy)
    await vi.advanceTimersByTimeAsync(10_100);
    expect(writeTextMock).toHaveBeenCalledTimes(3);
    expect(writeTextMock).toHaveBeenLastCalledWith("");
  });

  it("clears clipboard immediately when clearClipboardImmediately is invoked", () => {
    clearClipboardImmediately();
    expect(writeTextMock).toHaveBeenCalledWith("");
  });
});
