import { useState } from "react";
import { ImageDropzone } from "./ImageDropzone";
import { CameraCaptureView } from "./CameraCaptureView";
import { LensResultView } from "./LensResultView";
import { recognizeImage, type OcrProgress, type OcrResult } from "../../lib/ocr/ocrEngine";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ScanText, Sparkles, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type LensState = "idle" | "camera" | "processing" | "result";

export function LensScreen() {
  const [state, setState] = useState<LensState>("idle");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleImageSelected(imageBlob: Blob, url: string) {
    setImageUrl(url);
    setState("processing");
    setProgress({ status: "Starting OCR engine...", progress: 0.05, percent: 5 });
    setError(null);

    try {
      const ocrResult = await recognizeImage(imageBlob, (p) => {
        setProgress(p);
      });
      setResult(ocrResult);
      setState("result");
      if (ocrResult.text.length === 0) {
        toast.info("No readable text detected in this image.");
      } else {
        toast.success("Text extracted successfully!");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to extract text from image.");
      setState("idle");
      toast.error("OCR recognition failed");
    }
  }

  function handleReset() {
    if (imageUrl) {
      try {
        URL.revokeObjectURL(imageUrl);
      } catch {
        // ignore
      }
    }
    setImageUrl(null);
    setResult(null);
    setProgress(null);
    setError(null);
    setState("idle");
  }

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto py-2">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <ScanText className="size-6 text-primary" />
            <h2 className="text-2xl font-bold">Lens OCR</h2>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Extract, inspect, and copy text from images and live camera captures locally.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-xl flex items-start gap-3 text-destructive text-sm">
          <AlertCircle className="size-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Error processing image</p>
            <p className="text-xs text-destructive/80 mt-0.5">{error}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={handleReset}>
            Dismiss
          </Button>
        </div>
      )}

      {state === "idle" && (
        <ImageDropzone
          onImageSelected={handleImageSelected}
          onOpenCamera={() => setState("camera")}
        />
      )}

      {state === "camera" && (
        <CameraCaptureView
          onCapture={handleImageSelected}
          onCancel={() => setState("idle")}
        />
      )}

      {state === "processing" && (
        <div className="flex flex-col items-center justify-center p-12 border rounded-xl bg-card text-center min-h-[380px]">
          <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center mb-6 text-primary">
            <Sparkles className="size-8 animate-pulse" />
          </div>

          <h3 className="text-xl font-semibold mb-2">Analyzing Image...</h3>
          <p className="text-sm text-muted-foreground mb-6">
            {progress?.status ?? "Processing optical character recognition..."}
          </p>

          <div className="w-full max-w-md space-y-2">
            <div className="w-full bg-muted rounded-full h-3 overflow-hidden border">
              <div
                className="bg-primary h-full transition-all duration-300 rounded-full"
                style={{ width: `${progress?.percent ?? 10}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground px-1">
              <span>Client-side WebAssembly</span>
              <span>{progress?.percent ?? 10}%</span>
            </div>
          </div>

          <div className="mt-8 space-y-2 w-full max-w-md opacity-40">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4 mx-auto" />
          </div>
        </div>
      )}

      {state === "result" && result && imageUrl && (
        <LensResultView
          result={result}
          imageUrl={imageUrl}
          onReset={handleReset}
        />
      )}
    </div>
  );
}
