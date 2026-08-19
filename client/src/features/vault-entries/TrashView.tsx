/**
 * Trash panel: everything the user has moved to trash, with a
 * days-remaining chip per row and per-row restore / permanent-delete plus
 * a bulk empty-trash action. Shares the entry list's card layout and its
 * skeleton/error-with-retry/empty-state pattern (02-UI-SPEC.md's trash-view
 * state rows), and — like `EntryListScreen.tsx` — is the single owner of
 * its own fetch state rather than reusing the parent's.
 */

import { useEffect, useState } from "react";
import { CreditCard, KeyRound, LogIn, StickyNote } from "lucide-react";
import {
  emptyTrash,
  ENTRY_RENDER_WINDOW,
  listTrash,
  permanentlyDeleteEntry,
  restoreEntry,
  TRASH_RETENTION_DAYS,
  type EntrySummary,
} from "../../lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

const ENTRY_TYPE_ICONS: Record<EntrySummary["type"], typeof KeyRound> = {
  api_key: KeyRound,
  login: LogIn,
  note: StickyNote,
  card: CreditCard,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days remaining before `purgeExpiredTrash` removes this entry, floored to never show a fraction and clamped at zero rather than going negative while the purge hasn't run yet. */
function daysRemaining(deletedAt: string | null): number {
  if (!deletedAt) return TRASH_RETENTION_DAYS;
  const elapsedDays = Math.floor((Date.now() - new Date(deletedAt).getTime()) / DAY_MS);
  return Math.max(0, TRASH_RETENTION_DAYS - elapsedDays);
}

interface TrashViewProps {
  onRestored: () => void;
}

export default function TrashView({ onRestored }: TrashViewProps) {
  const [entries, setEntries] = useState<EntrySummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [emptyingTrash, setEmptyingTrash] = useState(false);
  const [visibleCount, setVisibleCount] = useState(ENTRY_RENDER_WINDOW);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);

    listTrash()
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [retryToken]);

  async function handleRestore(id: string): Promise<void> {
    await restoreEntry(id);
    setEntries((current) => (current ? current.filter((entry) => entry.id !== id) : current));
    onRestored();
  }

  async function handleDeleteForever(id: string): Promise<void> {
    await permanentlyDeleteEntry(id);
    setEntries((current) => (current ? current.filter((entry) => entry.id !== id) : current));
  }

  async function handleEmptyTrash(): Promise<void> {
    setEmptyingTrash(true);
    try {
      await emptyTrash();
      setEntries([]);
    } finally {
      setEmptyingTrash(false);
    }
  }

  if (entries === null && !loadError) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (entries === null && loadError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <div
          role="alert"
          className="w-full rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Couldn't load your trash.
        </div>
        <Button type="button" variant="outline" onClick={() => setRetryToken((n) => n + 1)}>
          Retry
        </Button>
      </div>
    );
  }

  const list = entries ?? [];

  if (list.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 py-16">
        <h2 className="text-[28px] leading-[1.2] font-semibold">Trash is empty</h2>
        {/* 02-UI-SPEC.md's exact copy contract. TRASH_RETENTION_DAYS drives every
            actual computation in this file (the days-remaining chip below); this
            sentence is the one place its value is spelled out as prose rather
            than interpolated, so keep the day count here in sync with the
            constant's value if it is ever changed. */}
        <p className="text-base text-muted-foreground">
          Deleted entries are kept for 30 days, then removed automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[20px] leading-[1.3] font-semibold">Trash</h2>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive" disabled={emptyingTrash}>
              Empty trash
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Empty trash?</AlertDialogTitle>
              <AlertDialogDescription>
                All {list.length} items in Trash will be permanently deleted. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={emptyingTrash}
                onClick={(event) => {
                  event.preventDefault();
                  void handleEmptyTrash();
                }}
              >
                Empty trash
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="flex flex-col gap-3">
        {list.slice(0, visibleCount).map((entry) => {
          const Icon = ENTRY_TYPE_ICONS[entry.type];
          const remaining = daysRemaining(entry.deletedAt);

          return (
            <Card key={entry.id} className="flex-row items-center gap-3 px-4">
              <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="flex flex-1 flex-col gap-1">
                <span className="text-base font-normal">{entry.name}</span>
                <div className="flex flex-wrap items-center gap-1">
                  <Badge variant="outline">{entry.folderName ?? "Uncategorized"}</Badge>
                  <Badge variant="secondary">{remaining} days left</Badge>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button type="button" variant="outline" onClick={() => void handleRestore(entry.id)}>
                  Restore
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive">
                      Delete forever
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete forever?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This cannot be undone. "{entry.name}" and its contents will be permanently
                        erased.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(event) => {
                          event.preventDefault();
                          void handleDeleteForever(entry.id);
                        }}
                      >
                        Delete forever
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </Card>
          );
        })}

        {list.length > visibleCount && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setVisibleCount((count) => count + ENTRY_RENDER_WINDOW)}
          >
            Show 200 more ({list.length - visibleCount} remaining)
          </Button>
        )}
      </div>
    </div>
  );
}
