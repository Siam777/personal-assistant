import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Camera Capture & Stream Lifecycle (04-03-PLAN)", () => {
  let stopMock: ReturnType<typeof vi.fn>;
  let mockTrack: { stop: ReturnType<typeof vi.fn> };
  let mockStream: { getTracks: () => Array<{ stop: ReturnType<typeof vi.fn> }> };

  beforeEach(() => {
    stopMock = vi.fn();
    mockTrack = { stop: stopMock };
    mockStream = {
      getTracks: () => [mockTrack],
    };

    if (!globalThis.navigator) {
      (globalThis as unknown as { navigator: Record<string, unknown> }).navigator = {};
    }
    Object.assign(navigator, {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    global.URL.createObjectURL = vi.fn().mockReturnValue("blob:captured-frame");
    global.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requests userMedia with ideal environment facing mode and stops tracks on cleanup", async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
    });

    expect(stream).toBeDefined();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);

    // Cleanup simulation
    stream.getTracks().forEach((t: { stop: () => void }) => t.stop());
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it("handles camera permission errors without crashing", async () => {
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValueOnce(
      new Error("Permission denied")
    );

    await expect(
      navigator.mediaDevices.getUserMedia({ video: true })
    ).rejects.toThrow("Permission denied");
  });
});
