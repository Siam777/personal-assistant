import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyToClipboard, type CopySecretOptions } from "../lib/clipboard";

interface CopyButtonProps extends CopySecretOptions {
  value: string;
  className?: string;
  size?: "sm" | "default" | "icon";
}

export function CopyButton({
  value,
  label = "Field",
  clearAfterMs = 30_000,
  entryId,
  entryName,
  entryType,
  fieldName,
  isSecret = true,
  className = "",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    const success = await copyToClipboard(value, {
      label,
      clearAfterMs,
      entryId,
      entryName,
      entryType,
      fieldName,
      isSecret,
    });
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${className}`}
    >
      {copied ? (
        <Check className="size-4 text-green-500" aria-hidden="true" />
      ) : (
        <Copy className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}
