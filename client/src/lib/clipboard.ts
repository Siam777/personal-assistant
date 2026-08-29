/**
 * Clipboard management with automatic 30-second memory clearing (TRUST-01, TRUST-02).
 *
 * When a secret is copied:
 * 1. Writes secret to navigator.clipboard.
 * 2. Arms a 30-second timer to overwrite the clipboard with an empty string.
 * 3. Shows toast feedback to the user ("Secret copied. Clipboard will clear in 30s").
 * 4. Dispatches an audit event (`secret_copied`) without leaking the secret value.
 *
 * Provides a global cleanup function `clearClipboardImmediately()` for session locks.
 */

import { toast } from "sonner";
import { reportAuditEvent } from "./api";

let activeClearTimer: ReturnType<typeof setTimeout> | null = null;

export interface CopySecretOptions {
  label?: string;
  clearAfterMs?: number;
  entryId?: string;
  entryName?: string;
  entryType?: string;
  fieldName?: string;
  isSecret?: boolean;
}

export async function copyToClipboard(
  text: string,
  options: CopySecretOptions = {}
): Promise<boolean> {
  const {
    label = "Secret",
    clearAfterMs = 30_000,
    entryId,
    entryName,
    entryType,
    fieldName,
    isSecret = true,
  } = options;

  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    toast.error("Clipboard API unavailable");
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);

    // Cancel any prior timer
    if (activeClearTimer !== null) {
      clearTimeout(activeClearTimer);
      activeClearTimer = null;
    }

    if (isSecret) {
      const seconds = Math.round(clearAfterMs / 1000);

      toast.success(`${label} copied`, {
        description: `Clipboard will auto-clear in ${seconds}s`,
        duration: 3000,
      });

      // Report audit event without secret string
      void reportAuditEvent({
        eventType: "secret_copied",
        entryId,
        entryName,
        entryType,
        fieldName,
      });

      activeClearTimer = setTimeout(() => {
        void (async () => {
          try {
            if (navigator?.clipboard?.writeText) {
              await navigator.clipboard.writeText("");
              toast.info("Clipboard cleared for security", { duration: 2500 });
            }
          } catch {
            // Ignore clipboard write failures if window is inactive
          } finally {
            activeClearTimer = null;
          }
        })();
      }, clearAfterMs);
    } else {
      toast.success(`${label} copied`, { duration: 2000 });
    }

    return true;
  } catch {
    toast.error("Failed to copy to clipboard");
    return false;
  }
}

export function clearClipboardImmediately(): void {
  if (activeClearTimer !== null) {
    clearTimeout(activeClearTimer);
    activeClearTimer = null;
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText("").catch(() => {});
  }
}
