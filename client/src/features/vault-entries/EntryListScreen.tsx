/**
 * Entry list container: fetch, loading/error/populated/partial/zero-one-many
 * states, selection, and the "New entry"/edit dialog. Mirrors `App.tsx`'s
 * fetch-on-mount effect (cancelled-flag cleanup). Selecting a card renders
 * `EntryDetail` beside the list; `EntryDetail`'s `onEdit` reopens the same
 * dialog in edit mode, and `onDeleted` clears the selection and drops the
 * entry from local list state without a full refetch.
 */

import { useEffect, useState } from "react";
import { CreditCard, KeyRound, LogIn, StickyNote } from "lucide-react";
import { listEntries, type Entry, type EntrySummary } from "../../lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import EntryDetail from "./EntryDetail";
import EntryForm from "./EntryForm";

const ENTRY_TYPE_ICONS: Record<EntrySummary["type"], typeof KeyRound> = {
  api_key: KeyRound,
  login: LogIn,
  note: StickyNote,
  card: CreditCard,
};

function formatRelativeUpdatedAt(isoTimestamp: string): string {
  const updatedAtMs = new Date(isoTimestamp).getTime();
  const diffMs = Date.now() - updatedAtMs;
  const diffMinutes = Math.round(diffMs / 60_000);

  if (diffMinutes < 1) return "Updated just now";
  if (diffMinutes < 60) return `Updated ${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `Updated ${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `Updated ${diffDays}d ago`;
}

export default function EntryListScreen() {
  const [entries, setEntries] = useState<EntrySummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    listEntries()
      .then((result) => {
        if (!cancelled) {
          setEntries(result);
          setLoadError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [retryToken]);

  // A saved entry's `folderName` and `tags` are server-joined/resolved
  // values (folder name lookup, tag create-on-the-fly resolution) that the
  // client cannot correctly synthesize from the `Entry` DTO alone, so a
  // save now triggers a refetch through the same effect the Retry button
  // uses, rather than splicing a hand-built summary into local state.
  function handleSaved(): void {
    setDialogOpen(false);
    setEditingEntry(null);
    setRetryToken((n) => n + 1);
  }

  function handleEdit(entry: Entry): void {
    setEditingEntry(entry);
    setDialogOpen(true);
  }

  function handleDeleted(): void {
    setEntries((current) => (current ? current.filter((e) => e.id !== selectedId) : current));
    setSelectedId(null);
  }

  const newEntryButton = (
    <DialogTrigger asChild>
      <Button type="button" onClick={() => setEditingEntry(null)}>
        New entry
      </Button>
    </DialogTrigger>
  );

  // Initial load only — nothing fetched yet and no error yet either.
  if (entries === null && !loadError) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  // Initial load failed — nothing was ever loaded, so there is no stale
  // list to keep showing underneath the banner.
  if (entries === null && loadError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <div
          role="alert"
          className="w-full rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Couldn't load your entries.
        </div>
        <Button type="button" variant="outline" onClick={() => setRetryToken((n) => n + 1)}>
          Retry
        </Button>
      </div>
    );
  }

  const list = entries ?? [];

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open) setEditingEntry(null);
      }}
    >
      {loadError && (
        <div
          role="alert"
          className="mb-4 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>Couldn't load your entries.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setRetryToken((n) => n + 1)}>
            Retry
          </Button>
        </div>
      )}

      {list.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-16">
          <h2 className="text-[28px] leading-[1.2] font-semibold">Your vault is empty</h2>
          <p className="text-base text-muted-foreground">
            Add your first API key, login, note, or card to get started.
          </p>
          {newEntryButton}
        </div>
      ) : (
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
          <div className="flex flex-1 flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <h2 className="text-[20px] leading-[1.3] font-semibold">Vault</h2>
                {list.length > 1 && (
                  <span className="text-sm font-semibold text-muted-foreground">
                    {list.length} entries
                  </span>
                )}
              </div>
              {newEntryButton}
            </div>
            <div className="flex flex-col gap-3">
              {list.map((entry) => {
                const Icon = ENTRY_TYPE_ICONS[entry.type];
                const isSelected = entry.id === selectedId;
                return (
                  <Card
                    key={entry.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(entry.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(entry.id);
                      }
                    }}
                    className={`flex-row items-center gap-3 px-4 ${
                      isSelected ? "ring-2 ring-ring" : ""
                    }`}
                  >
                    <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="flex flex-1 flex-col">
                      <span className="text-base font-normal">{entry.name}</span>
                      <span className="text-sm font-semibold text-muted-foreground">
                        {formatRelativeUpdatedAt(entry.updatedAt)}
                      </span>
                    </div>
                    {entry.folderId === null && <Badge variant="outline">Uncategorized</Badge>}
                  </Card>
                );
              })}
            </div>
          </div>

          {selectedId && (
            <div className="flex-1 rounded-xl bg-card p-6 ring-1 ring-foreground/10 md:max-w-md">
              <EntryDetail entryId={selectedId} onEdit={handleEdit} onDeleted={handleDeleted} />
            </div>
          )}
        </div>
      )}

      <DialogContent>
        <EntryForm key={editingEntry?.id ?? "create"} entry={editingEntry ?? undefined} onSaved={handleSaved} />
      </DialogContent>
    </Dialog>
  );
}
