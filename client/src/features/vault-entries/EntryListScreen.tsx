/**
 * Entry list container: fetch, state, empty state, and the "New entry"
 * affordance. Mirrors `App.tsx`'s fetch-on-mount effect (cancelled-flag
 * cleanup). Only `api_key` has a creation form in this plan (Plan 02-02
 * adds the other three entry types); the type picker this dialog would
 * otherwise show collapses to opening `EntryForm` directly.
 */

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { listEntries, type Entry, type EntrySummary } from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import EntryForm from "./EntryForm";

const ENTRY_TYPE_ICONS: Record<EntrySummary["type"], typeof KeyRound> = {
  api_key: KeyRound,
  login: KeyRound,
  note: KeyRound,
  card: KeyRound,
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
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    listEntries()
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load your entries.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleSaved(entry: Entry): void {
    setEntries((current) => {
      const summary: EntrySummary = {
        id: entry.id,
        type: entry.type,
        name: entry.name,
        folderId: entry.folderId,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      };
      return current ? [summary, ...current] : [summary];
    });
    setDialogOpen(false);
  }

  const newEntryButton = (
    <DialogTrigger asChild>
      <Button type="button">New entry</Button>
    </DialogTrigger>
  );

  if (error) {
    return (
      <div role="alert" className="text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (entries === null) {
    return <p className="text-sm text-muted-foreground">Loading your entries…</p>;
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      {entries.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-16">
          <h2 className="text-[28px] leading-[1.2] font-semibold">Your vault is empty</h2>
          <p className="text-base text-muted-foreground">
            Add your first API key, login, note, or card to get started.
          </p>
          {newEntryButton}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[20px] leading-[1.3] font-semibold">Vault</h2>
            {newEntryButton}
          </div>
          <div className="flex flex-col gap-3">
            {entries.map((entry) => {
              const Icon = ENTRY_TYPE_ICONS[entry.type];
              return (
                <Card key={entry.id} className="flex-row items-center gap-3 px-4">
                  <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="flex flex-1 flex-col">
                    <span className="text-[20px] leading-[1.3] font-semibold">{entry.name}</span>
                    <span className="text-sm font-semibold text-muted-foreground">
                      {formatRelativeUpdatedAt(entry.updatedAt)}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <DialogContent>
        <DialogHeader>
          <DialogTitle>New API key entry</DialogTitle>
        </DialogHeader>
        <EntryForm onSaved={handleSaved} />
      </DialogContent>
    </Dialog>
  );
}
