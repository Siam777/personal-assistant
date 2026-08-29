import { useState } from "react";
import { CopyButton } from "../../components/CopyButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { RotateCcw, Type, Sparkles } from "lucide-react";
import type { OcrResult } from "../../lib/ocr/ocrEngine";

interface LensResultViewProps {
  result: OcrResult;
  imageUrl: string;
  onReset: () => void;
}

export function LensResultView({ result, imageUrl, onReset }: LensResultViewProps) {
  const [editedText, setEditedText] = useState(result.text);
  const [isMono, setIsMono] = useState(false);

  const wordCount = editedText.trim().split(/\s+/).filter(Boolean).length;
  const charCount = editedText.length;

  function getConfidenceBadgeVariant(confidence: number) {
    if (confidence >= 80) return "default";
    if (confidence >= 50) return "secondary";
    return "destructive";
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      {/* Left Column: Image Source Preview */}
      <div className="w-full lg:w-1/3 flex flex-col gap-3">
        <div className="relative aspect-video lg:aspect-auto lg:h-[450px] w-full rounded-xl overflow-hidden border bg-black/5 flex items-center justify-center">
          <img
            src={imageUrl}
            alt="Scanned source"
            className="w-full h-full object-contain"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReset}
          className="w-full flex items-center justify-center gap-2"
        >
          <RotateCcw className="size-4" />
          <span>Scan Another Image</span>
        </Button>
      </div>

      {/* Right Column: Extracted & Editable Text */}
      <div className="w-full lg:w-2/3 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            <h3 className="font-semibold text-lg">Extracted Text</h3>
            <Badge variant={getConfidenceBadgeVariant(result.confidence)}>
              {result.confidence}% confidence
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {wordCount} words • {charCount} chars
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsMono(!isMono)}
              className="h-8 px-2 text-xs"
              title="Toggle font style"
            >
              <Type className="size-3.5 mr-1" />
              {isMono ? "Sans" : "Mono"}
            </Button>
          </div>
        </div>

        {/* Editable Preview Textarea */}
        <div className="relative flex flex-col">
          <Textarea
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
            rows={14}
            className={`w-full resize-y text-base p-4 min-h-[300px] leading-relaxed ${
              isMono ? "font-mono text-sm" : "font-sans"
            }`}
            placeholder="No text detected in image"
          />
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center justify-between gap-4 pt-2">
          <div className="text-xs text-muted-foreground">
            Edit any misread text above before copying.
          </div>

          <div className="flex items-center gap-2">
            <CopyButton
              value={editedText}
              label="Extracted text"
              isSecret={false}
              className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 h-10 w-auto gap-2"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
