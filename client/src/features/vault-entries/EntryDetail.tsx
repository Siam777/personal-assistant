/**
 * The surface where a stored secret is actually used: fetches one entry
 * by id, renders every field of that entry's type, and masks secret
 * fields by default with a per-field reveal toggle. Mirrors
 * `vault-2fa/BackupCodesPanel.tsx`'s "reveal is a deliberate, scoped
 * action" posture and `session.ts`'s `armIdleTimer` "re-lock aggressively
 * rather than leave sensitive state exposed" posture — but per-field and
 * client-side: each reveal gets its own 30s timer, and every timer is
 * cleared (and the revealed set emptied) in the fetch effect's cleanup, so
 * navigating to a different entry or unmounting this panel re-masks
 * everything immediately, never waiting for the timer to naturally elapse.
 */

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { deleteEntry, getEntry, reportAuditEvent, type Entry, type EntryType } from "../../lib/api";
import { CopyButton } from "../../components/CopyButton";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface EntryDetailProps {
  entryId: string;
  onEdit: (entry: Entry) => void;
  onDeleted: () => void;
}

interface DetailField {
  key: string;
  label: string;
  secret: boolean;
}

const TYPE_DETAIL_FIELDS: Record<EntryType, DetailField[]> = {
  api_key: [
    { key: "key", label: "Key", secret: true },
    { key: "endpoint", label: "Endpoint", secret: false },
    { key: "model", label: "Model", secret: false },
  ],
  login: [
    { key: "username", label: "Username", secret: false },
    { key: "password", label: "Password", secret: true },
    { key: "url", label: "URL", secret: false },
  ],
  note: [{ key: "body", label: "Body", secret: true }],
  card: [
    { key: "number", label: "Card number", secret: true },
    { key: "expiry", label: "Expiry", secret: false },
    { key: "cvv", label: "CVV", secret: true },
    { key: "cardholder", label: "Cardholder name", secret: false },
  ],
};

const REVEAL_DURATION_MS = 30_000;
const MASKED_PLACEHOLDER = "••••••••••••";

export default function EntryDetail({ entryId, onEdit, onDeleted }: EntryDetailProps) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    let cancelled = false;
    setEntry(null);
    setLoadFailed(false);

    getEntry(entryId)
      .then((result) => {
        if (!cancelled) setEntry(result);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
      // Re-masks everything immediately on entry change or unmount — each
      // field's 30s window is independent, but none of them survive
      // navigating away from this entry.
      setRevealed(new Set());
      for (const timer of Object.values(timersRef.current)) {
        clearTimeout(timer);
      }
      timersRef.current = {};
    };
  }, [entryId, retryToken]);

  function armRevealTimer(key: string): void {
    const existing = timersRef.current[key];
    if (existing) clearTimeout(existing);
    timersRef.current[key] = setTimeout(() => {
      setRevealed((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      delete timersRef.current[key];
    }, REVEAL_DURATION_MS);
  }

  function toggleReveal(key: string): void {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
        const timer = timersRef.current[key];
        if (timer) {
          clearTimeout(timer);
          delete timersRef.current[key];
        }
      } else {
        next.add(key);
        armRevealTimer(key);
        if (entry) {
          void reportAuditEvent({
            eventType: "secret_revealed",
            entryId: entry.id,
            entryName: entry.name,
            entryType: entry.type,
            fieldName: key,
          });
        }
      }
      return next;
    });
  }

  async function handleConfirmDelete(): Promise<void> {
    setDeleting(true);
    try {
      await deleteEntry(entryId);
      onDeleted();
    } finally {
      setDeleting(false);
    }
  }

  if (loadFailed) {
    return (
      <div className="flex flex-col items-start gap-3 py-8">
        <p className="text-base text-destructive">Couldn't load this entry</p>
        <Button type="button" variant="outline" onClick={() => setRetryToken((n) => n + 1)}>
          Retry
        </Button>
      </div>
    );
  }

  if (entry === null) {
    return (
      <div className="flex flex-col gap-4 py-2" aria-hidden="true">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-1/2" />
      </div>
    );
  }

  const payload = entry.payload as unknown as Record<string, string | undefined>;
  const fields = TYPE_DETAIL_FIELDS[entry.type];

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[20px] leading-[1.3] font-semibold">{entry.name}</h2>

      <div className="flex flex-col gap-3">
        {fields.map((cfg) => {
          const rawValue = payload[cfg.key];
          const hasValue = typeof rawValue === "string" && rawValue.trim().length > 0;
          const isRevealed = revealed.has(cfg.key);

          return (
            <div key={cfg.key} className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-muted-foreground">{cfg.label}</span>
              {!hasValue ? (
                <span className="text-base text-muted-foreground">Not set</span>
              ) : cfg.secret ? (
                <div className="flex items-center gap-1">
                  <span className="font-mono text-base break-all">
                    {isRevealed ? rawValue : MASKED_PLACEHOLDER}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleReveal(cfg.key)}
                    aria-label={isRevealed ? `Hide ${cfg.label}` : `Reveal ${cfg.label}`}
                    className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {isRevealed ? (
                      <EyeOff className="size-5" aria-hidden="true" />
                    ) : (
                      <Eye className="size-5" aria-hidden="true" />
                    )}
                  </button>
                  <CopyButton
                    value={rawValue}
                    label={cfg.label}
                    entryId={entry.id}
                    entryName={entry.name}
                    entryType={entry.type}
                    fieldName={cfg.key}
                    isSecret={true}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-base">{rawValue}</span>
                  <CopyButton
                    value={rawValue}
                    label={cfg.label}
                    entryId={entry.id}
                    entryName={entry.name}
                    entryType={entry.type}
                    fieldName={cfg.key}
                    isSecret={false}
                  />
                </div>
              )}
            </div>
          );
        })}

        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-muted-foreground">Notes</span>
          {entry.notes && entry.notes.trim().length > 0 ? (
            <span className="text-base whitespace-pre-wrap">{entry.notes}</span>
          ) : (
            <span className="text-base text-muted-foreground">Not set</span>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="button" onClick={() => onEdit(entry)}>
          Edit
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive">
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Move to trash?</AlertDialogTitle>
              <AlertDialogDescription>
                "{entry.name}" will move to Trash and be permanently deleted after 30 days. You
                can restore it anytime before then.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting}
                onClick={(event) => {
                  event.preventDefault();
                  void handleConfirmDelete();
                }}
              >
                Move to trash
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
