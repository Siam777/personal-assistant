import { useEffect, useRef, useState } from "react";
import { Camera, X, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CameraCaptureViewProps {
  onCapture: (blob: Blob, url: string) => void;
  onCancel: () => void;
}

export function CameraCaptureView({ onCapture, onCancel }: CameraCaptureViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function stopCameraStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  async function startCamera() {
    setLoading(true);
    setError(null);
    stopCameraStream();

    if (!navigator?.mediaDevices?.getUserMedia) {
      setError("Camera API is not supported on this browser/device.");
      setLoading(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setLoading(false);
    } catch (err: unknown) {
      stopCameraStream();
      setLoading(false);
      if (err instanceof Error && err.name === "NotAllowedError") {
        setError("Camera permission was denied. Please allow camera access in your browser.");
      } else if (err instanceof Error && err.name === "NotFoundError") {
        setError("No camera device was found on this system.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to access camera.");
      }
    }
  }

  useEffect(() => {
    void startCamera();

    return () => {
      stopCameraStream();
    };
  }, []);

  function handleCaptureFrame() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        stopCameraStream();
        onCapture(blob, url);
      },
      "image/jpeg",
      0.95
    );
  }

  return (
    <div className="relative flex flex-col items-center justify-center p-4 bg-black/90 text-white rounded-xl overflow-hidden min-h-[420px]">
      {/* Header Close button */}
      <button
        type="button"
        onClick={() => {
          stopCameraStream();
          onCancel();
        }}
        aria-label="Close camera"
        className="absolute top-4 right-4 z-20 size-10 rounded-full bg-black/50 hover:bg-black/80 flex items-center justify-center text-white transition-colors"
      >
        <X className="size-5" />
      </button>

      {error ? (
        <div className="flex flex-col items-center justify-center p-8 text-center max-w-md">
          <AlertCircle className="size-12 text-destructive mb-3" />
          <h4 className="text-lg font-semibold mb-2">Camera Unavailable</h4>
          <p className="text-sm text-gray-300 mb-6">{error}</p>
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void startCamera()}
              className="text-black bg-white hover:bg-gray-100"
            >
              <RefreshCw className="size-4 mr-2" />
              Try Again
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                stopCameraStream();
                onCancel();
              }}
            >
              Back to Dropzone
            </Button>
          </div>
        </div>
      ) : (
        <div className="relative w-full max-w-2xl flex flex-col items-center">
          {/* Video element */}
          <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-black flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />

            {/* Viewfinder Target Frame Overlay */}
            <div className="absolute inset-8 border-2 border-white/60 rounded-lg pointer-events-none flex flex-col justify-between p-2">
              <div className="flex justify-between">
                <span className="size-4 border-t-2 border-l-2 border-white" />
                <span className="size-4 border-t-2 border-r-2 border-white" />
              </div>
              <p className="text-center text-xs text-white/80 drop-shadow-md">
                Align document or text within frame
              </p>
              <div className="flex justify-between">
                <span className="size-4 border-b-2 border-l-2 border-white" />
                <span className="size-4 border-b-2 border-r-2 border-white" />
              </div>
            </div>

            {loading && (
              <div className="absolute inset-0 bg-black/80 flex items-center justify-center text-white">
                <RefreshCw className="size-8 animate-spin" />
              </div>
            )}
          </div>

          {/* Shutter Capture Button */}
          <div className="mt-4 flex items-center justify-center gap-4">
            <Button
              type="button"
              size="lg"
              onClick={handleCaptureFrame}
              disabled={loading}
              className="size-14 rounded-full p-0 bg-white hover:bg-gray-200 text-black shadow-lg flex items-center justify-center"
              title="Capture & Scan"
              aria-label="Capture photo"
            >
              <Camera className="size-6 text-primary" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
