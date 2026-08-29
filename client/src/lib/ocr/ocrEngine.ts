/**
 * Core OCR Recognition Engine using Tesseract.js (OCR-01, OCR-03).
 *
 * Runs purely on the client side via WebAssembly & Web Workers.
 * Zero image data or text content is ever transmitted across the network.
 */

import { createWorker, type Worker } from "tesseract.js";

export interface OcrProgress {
  status: string;
  progress: number; // 0 to 1
  percent: number; // 0 to 100
}

export interface OcrResult {
  text: string;
  confidence: number; // 0 to 100
  lines: string[];
  wordsCount: number;
  charsCount: number;
}

let workerInstance: Worker | null = null;
let workerInitPromise: Promise<Worker> | null = null;

/**
 * Lazily initializes and returns a shared Tesseract worker.
 */
async function getWorker(onProgress?: (p: OcrProgress) => void): Promise<Worker> {
  if (workerInstance) {
    return workerInstance;
  }

  if (!workerInitPromise) {
    workerInitPromise = (async () => {
      const worker = await createWorker("eng", 1, {
        logger: (m) => {
          if (onProgress && typeof m.progress === "number") {
            const statusLabel =
              m.status === "recognizing text"
                ? "Recognizing text..."
                : m.status === "loading tesseract core"
                  ? "Loading OCR engine..."
                  : m.status === "initializing tesseract"
                    ? "Initializing language model..."
                    : m.status;

            onProgress({
              status: statusLabel,
              progress: m.progress,
              percent: Math.round(m.progress * 100),
            });
          }
        },
      });
      workerInstance = worker;
      return worker;
    })();
  }

  return workerInitPromise;
}

/**
 * Calculates new dimensions keeping aspect ratio capped at maxDimension.
 */
export function calculateScaledDimensions(
  width: number,
  height: number,
  maxDimension = 2048
): { width: number; height: number; scaled: boolean } {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height, scaled: false };
  }

  const ratio = Math.min(maxDimension / width, maxDimension / height);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
    scaled: true,
  };
}

/**
 * Scales an image Blob down if it exceeds `maxDimension`, returning an optimized Blob.
 */
export async function downscaleImage(
  imageBlob: Blob,
  maxDimension = 2048
): Promise<Blob> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return imageBlob;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(imageBlob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height, scaled } = calculateScaledDimensions(
        img.naturalWidth,
        img.naturalHeight,
        maxDimension
      );

      if (!scaled) {
        resolve(imageBlob);
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        resolve(imageBlob);
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          resolve(blob ?? imageBlob);
        },
        "image/jpeg",
        0.92
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(imageBlob);
    };

    img.src = url;
  });
}

/**
 * Performs OCR text recognition on an image source (Blob, File, or DataURL).
 */
export async function recognizeImage(
  imageInput: Blob | File | string,
  onProgress?: (progress: OcrProgress) => void
): Promise<OcrResult> {
  let imageToProcess = imageInput;

  // If input is a Blob/File, pre-process downscale
  if (imageInput instanceof Blob) {
    imageToProcess = await downscaleImage(imageInput, 2048);
  }

  onProgress?.({
    status: "Initializing OCR...",
    progress: 0.1,
    percent: 10,
  });

  const worker = await getWorker(onProgress);

  const ret = await worker.recognize(imageToProcess);
  const data = ret.data;

  const rawText = data.text || "";
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const words = rawText.trim().split(/\s+/).filter(Boolean);
  const confidence = Math.max(0, Math.min(100, Math.round(data.confidence || 0)));

  onProgress?.({
    status: "Completed",
    progress: 1.0,
    percent: 100,
  });

  return {
    text: rawText.trim(),
    confidence,
    lines,
    wordsCount: words.length,
    charsCount: rawText.length,
  };
}

/**
 * Terminates the worker instance to release memory.
 */
export async function terminateOcrWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.terminate();
    workerInstance = null;
    workerInitPromise = null;
  }
}
