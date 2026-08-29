import { useEffect, useRef, useState, type DragEvent } from "react";
import { Upload, Camera, Image as ImageIcon, Clipboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface ImageDropzoneProps {
  onImageSelected: (imageBlob: Blob, imageUrl: string) => void;
  onOpenCamera: () => void;
  disabled?: boolean;
}

const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/bmp",
  "image/gif",
]);

export function ImageDropzone({
  onImageSelected,
  onOpenCamera,
  disabled = false,
}: ImageDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function processFile(file: File | Blob) {
    if (!ACCEPTED_IMAGE_TYPES.has(file.type) && !file.type.startsWith("image/")) {
      toast.error("Unsupported file type", {
        description: "Please select an image file (PNG, JPG, WebP, BMP, GIF)",
      });
      return;
    }

    const url = URL.createObjectURL(file);
    onImageSelected(file, url);
  }

  // Handle global clipboard paste (Ctrl+V screenshot capture)
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      if (disabled) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf("image") !== -1) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            toast.info("Image pasted from clipboard");
            processFile(blob);
            return;
          }
        }
      }
    }

    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, [disabled]);

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (disabled) return;
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex flex-col items-center justify-center p-8 sm:p-12 border-2 border-dashed rounded-xl transition-all duration-200 text-center ${
        isDragging
          ? "border-primary bg-primary/5 scale-[1.01]"
          : "border-border hover:border-primary/50 bg-card/40"
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
        onChange={handleFileInputChange}
        className="hidden"
        disabled={disabled}
      />

      <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary">
        <Upload className="size-8" />
      </div>

      <h3 className="text-xl font-semibold mb-1">Scan or extract text from image</h3>
      <p className="text-sm text-muted-foreground max-w-md mb-6">
        Drag & drop an image here, browse from your files, or press{" "}
        <kbd className="px-1.5 py-0.5 text-xs font-semibold bg-muted rounded border">Ctrl+V</kbd>{" "}
        to paste a screenshot.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="flex items-center gap-2"
        >
          <ImageIcon className="size-4" />
          <span>Upload Image</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={onOpenCamera}
          disabled={disabled}
          className="flex items-center gap-2"
        >
          <Camera className="size-4 text-primary" />
          <span>Use Live Camera</span>
        </Button>
      </div>

      <div className="mt-8 flex items-center gap-6 text-xs text-muted-foreground border-t pt-4">
        <div className="flex items-center gap-1.5">
          <Clipboard className="size-3.5" />
          <span>Clipboard paste supported</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500 inline-block" />
          <span>Local client-side OCR</span>
        </div>
      </div>
    </div>
  );
}
