import { describe, expect, it, vi } from "vitest";
import {
  calculateScaledDimensions,
  recognizeImage,
  type OcrProgress,
} from "./ocrEngine";

// Mock tesseract.js createWorker
vi.mock("tesseract.js", () => {
  return {
    createWorker: vi.fn().mockImplementation(async (_lang: string, _mode: number, options?: { logger?: (m: unknown) => void }) => {
      return {
        recognize: vi.fn().mockImplementation(async (_img: unknown) => {
          options?.logger?.({ status: "recognizing text", progress: 0.75 });
          return {
            data: {
              text: "Hello World\nLine 2 text with API_KEY_12345",
              confidence: 94.6,
            },
          };
        }),
        terminate: vi.fn().mockResolvedValue(undefined),
      };
    }),
  };
});

describe("OCR Recognition Engine (04-01-PLAN)", () => {
  it("calculates scaled dimensions correctly preserving aspect ratio", () => {
    // 1. Under limit -> not scaled
    const res1 = calculateScaledDimensions(1200, 800, 2048);
    expect(res1).toEqual({ width: 1200, height: 800, scaled: false });

    // 2. Landscape over limit (4000x2000) -> scaled to 2048x1024
    const res2 = calculateScaledDimensions(4000, 2000, 2048);
    expect(res2.scaled).toBe(true);
    expect(res2.width).toBe(2048);
    expect(res2.height).toBe(1024);

    // 3. Portrait over limit (3000x6000) -> scaled to 1024x2048
    const res3 = calculateScaledDimensions(3000, 6000, 2048);
    expect(res3.scaled).toBe(true);
    expect(res3.width).toBe(1024);
    expect(res3.height).toBe(2048);
  });

  it("recognizes text from an image and parses lines and metrics", async () => {
    const progressEvents: OcrProgress[] = [];
    const result = await recognizeImage("data:image/png;base64,mock", (p) => {
      progressEvents.push(p);
    });

    expect(result.text).toContain("Hello World");
    expect(result.text).toContain("API_KEY_12345");
    expect(result.confidence).toBe(95);
    expect(result.lines).toEqual(["Hello World", "Line 2 text with API_KEY_12345"]);
    expect(result.wordsCount).toBe(7);
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents.some((p) => p.percent === 100)).toBe(true);
  });
});
