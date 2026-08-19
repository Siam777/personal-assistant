/**
 * Entry list container: the single owner of the `query`/`selectedFolderId`/
 * `activeTag` filter state and the single caller of `listEntries` — the
 * folder sidebar, tag filter row, and search box are four views of one
 * filtered query rather than four independent data paths. Mirrors
 * `App.tsx`'s fetch-on-mount effect (cancelled-flag cleanup). Selecting a
 * card renders `EntryDetail` beside the list; `EntryDetail`'s `onEdit`
 * reopens the same dialog in edit mode, and `onDeleted` triggers the same
 * single fetch path a filter change would.
 */

import { useEffect, useState, type ReactNode } from "react";
import { CreditCard, KeyRound, LogIn, StickyNote } from "lucide-react";
import { ENTRY_RENDER_WINDOW, listEntries, type Entry, type EntrySummary } from "../../lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import EntryDetail from "./EntryDetail";
import EntryForm from "./EntryForm";
import FolderSidebar from "./FolderSidebar";
import SearchBar from "./SearchBar";
import TagFilter from "./TagFilter";
import TrashView from "./TrashView";

const ENTRY_TYPE_ICONS: Record<EntrySummary["type"], typeof KeyRound> = {
  api_key: KeyRound,
  login: LogIn,
  note: StickyNote,
  card: CreditCard,
};

const SEARCH_FAILURE_MESSAGE = "Search is temporarily unavailable. Your entries are safe — try again in a moment.";
const MAX_VISIBLE_TAGS = 3;

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

/** Splits `name` into text nodes around the first case-insensitive match of `query`, bolding the match — never via `dangerouslySetInnerHTML`. */
function renderHighlightedName(name: string, query: string): ReactNode {
  const trimmed = query.trim();
  if (trimmed.length === 0) return name;

  const matchIndex = name.toLowerCase().indexOf(trimmed.toLowerCase());
  if (matchIndex === -1) return name;

  const before = name.slice(0, matchIndex);
  const match = name.slice(matchIndex, matchIndex + trimmed.length);
  const after = name.slice(matchIndex + trimmed.length);

  return (
    <>
      {before}
      <span className="font-semibold text-primary">{match}</span>
      {after}
    </>
  );
}

export default function EntryListScreen() {
  const [entries, setEntries] = useState<EntrySummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [tagsVersion, setTagsVersion] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewingTrash, setViewingTrash] = useState(false);

  const [query, setQuery] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(ENTRY_RENDER_WINDOW);

  // Narrowing a search (or switching folder/tag) must not leave a stale
  // expanded window from a previous, larger result set — reset on every
  // filter-input change, independent of the data-fetch effect below so a
  // plain refetch (save, delete, restore) does not also collapse the window.
  useEffect(() => {
    setVisibleCount(ENTRY_RENDER_WINDOW);
  }, [query, selectedFolderId, activeTag]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    listEntries({
      q: query,
      folderId: selectedFolderId ?? undefined,
      tag: activeTag ?? undefined,
    })
      .then((result) => {
        if (!cancelled) {
          setEntries(result);
          setLoadError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query, selectedFolderId, activeTag, retryToken]);

  function refetch(): void {
    setRetryToken((n) => n + 1);
    setTagsVersion((n) => n + 1);
  }

  function handleSaved(): void {
    setDialogOpen(false);
    setEditingEntry(null);
    refetch();
  }

  function handleEdit(entry: Entry): void {
    setEditingEntry(entry);
    setDialogOpen(true);
  }

  function handleDeleted(): void {
    setSelectedId(null);
    refetch();
  }

  function handleClearFilters(): void {
    setQuery("");
    setSelectedFolderId(null);
    setActiveTag(null);
  }

  const newEntryButton = (
    <DialogTrigger asChild>
      <Button type="button" onClick={() => setEditingEntry(null)}>
        New entry
      </Button>
    </DialogTrigger>
  );

  // Nothing has ever loaded yet — no stale list to keep showing underneath
  // a skeleton or a banner.
  if (entries === null && !loadError) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
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
          Couldn't load your entries.
        </div>
        <Button type="button" variant="outline" onClick={() => setRetryToken((n) => n + 1)}>
          Retry
        </Button>
      </div>
    );
  }

  const list = entries ?? [];
  const hasActiveFilter = query.trim().length > 0 || selectedFolderId !== null || activeTag !== null;
  const hasQuery = query.trim().length > 0;

  // The truly-empty vault (no entries anywhere, no filter applied) keeps
  // the full-page empty state from 02-01 rather than the sidebar/search
  // layout — there is nothing yet to organize or search across. A vault can
  // still have trashed entries in this state (the user deleted everything
  // that was ever created), so "View trash" stays reachable here too;
  // selecting it falls through to the full sidebar/content layout below
  // rather than duplicating TrashView's rendering in this branch.
  if (list.length === 0 && !hasActiveFilter && !viewingTrash) {
    return (
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingEntry(null);
        }}
      >
        <div className="flex flex-col items-start gap-3 py-16">
          <h2 className="text-[28px] leading-[1.2] font-semibold">Your vault is empty</h2>
          <p className="text-base text-muted-foreground">
            Add your first API key, login, note, or card to get started.
          </p>
          <div className="flex items-center gap-4">
            {newEntryButton}
            <button
              type="button"
              onClick={() => setViewingTrash(true)}
              className="text-sm font-semibold text-primary hover:underline"
            >
              View trash
            </button>
          </div>
        </div>
        <DialogContent>
          <EntryForm key={editingEntry?.id ?? "create"} entry={editingEntry ?? undefined} onSaved={handleSaved} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open) setEditingEntry(null);
      }}
    >
      <div className="flex gap-8">
        <div className="flex flex-col gap-3">
          <FolderSidebar
            selectedFolderId={selectedFolderId}
            onSelect={setSelectedFolderId}
            onFoldersChanged={refetch}
          />
          <button
            type="button"
            onClick={() => setViewingTrash(true)}
            className="px-2 py-1.5 text-left text-sm font-semibold text-primary hover:underline"
          >
            View trash
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-8">
          {viewingTrash ? (
            <>
              <button
                type="button"
                onClick={() => setViewingTrash(false)}
                className="self-start text-sm font-semibold text-primary hover:underline"
              >
                Back to vault
              </button>
              <TrashView onRestored={refetch} />
            </>
          ) : (
            <>
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-[20px] leading-[1.3] font-semibold">Vault</h2>
                  {newEntryButton}
                </div>

                <SearchBar value={query} onChange={setQuery} searching={loading} />

                {loadError && (
                  <p className="text-sm text-destructive">{SEARCH_FAILURE_MESSAGE}</p>
                )}

                <TagFilter key={tagsVersion} activeTag={activeTag} onSelect={setActiveTag} />

                {list.length > 0 &&
                  (hasQuery ? (
                    <span className="text-sm font-semibold text-muted-foreground">
                      {list.length} results for "{query}"
                    </span>
                  ) : (
                    list.length > 1 && (
                      <span className="text-sm font-semibold text-muted-foreground">{list.length} entries</span>
                    )
                  ))}
              </div>

              {loading ? (
                <div className="flex flex-col gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : list.length === 0 ? (
                <div className="flex flex-col items-start gap-3 py-16">
                  <h2 className="text-[28px] leading-[1.2] font-semibold">No matches</h2>
                  <p className="text-base text-muted-foreground">
                    No entries match "{query}". Try a different search term or clear your filters.
                  </p>
                  <Button type="button" variant="outline" onClick={handleClearFilters}>
                    Clear filters
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
                  <div className="flex flex-1 flex-col gap-3">
                    {list.slice(0, visibleCount).map((entry) => {
                      const Icon = ENTRY_TYPE_ICONS[entry.type];
                      const isSelected = entry.id === selectedId;
                      const visibleTags = entry.tags.slice(0, MAX_VISIBLE_TAGS);
                      const extraTagCount = entry.tags.length - visibleTags.length;

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
                          className={`flex-row items-center gap-3 px-4 ${isSelected ? "ring-2 ring-ring" : ""}`}
                        >
                          <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <div className="flex flex-1 flex-col gap-1">
                            <span className="text-base font-normal">{renderHighlightedName(entry.name, query)}</span>
                            <span className="text-sm font-semibold text-muted-foreground">
                              {formatRelativeUpdatedAt(entry.updatedAt)}
                            </span>
                            <div className="flex flex-wrap items-center gap-1">
                              <Badge variant="outline">{entry.folderName ?? "Uncategorized"}</Badge>
                              {visibleTags.map((tag) => (
                                <Badge key={tag} variant="secondary">
                                  {tag}
                                </Badge>
                              ))}
                              {extraTagCount > 0 && <Badge variant="secondary">+{extraTagCount}</Badge>}
                            </div>
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

                  {selectedId && (
                    <div className="flex-1 rounded-xl bg-card p-6 ring-1 ring-foreground/10 md:max-w-md">
                      <EntryDetail entryId={selectedId} onEdit={handleEdit} onDeleted={handleDeleted} />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <DialogContent>
        <EntryForm key={editingEntry?.id ?? "create"} entry={editingEntry ?? undefined} onSaved={handleSaved} />
      </DialogContent>
    </Dialog>
  );
}
