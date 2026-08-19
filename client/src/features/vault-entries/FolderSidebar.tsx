/**
 * Flat folder navigation: "All entries" (never deletable) plus the user's
 * folders below it, each with a rename/delete dropdown. Own fetch/loading/
 * error state, kept local so a folder-fetch failure never blocks the entry
 * list from rendering (UI-SPEC folder-nav error row).
 */

import { useEffect, useState, type KeyboardEvent } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { createFolder, deleteFolder, listFolders, renameFolder, type Folder } from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

interface FolderSidebarProps {
  selectedFolderId: string | null;
  onSelect: (folderId: string | null) => void;
  onFoldersChanged?: () => void;
}

export default function FolderSidebar({ selectedFolderId, onSelect, onFoldersChanged }: FolderSidebarProps) {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);

    listFolders()
      .then((result) => {
        if (!cancelled) setFolders(result);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [retryToken]);

  function refresh(): void {
    setRetryToken((n) => n + 1);
    onFoldersChanged?.();
  }

  async function handleCreateSubmit(): Promise<void> {
    const name = newFolderName.trim();
    if (name.length === 0) return;
    try {
      await createFolder(name);
      setNewFolderName("");
      setCreating(false);
      refresh();
    } catch {
      // The sidebar has no dedicated create-error surface in the UI-SPEC;
      // leaving the inline input open with the typed value lets the user
      // retry without losing their input.
    }
  }

  async function handleRenameSubmit(id: string): Promise<void> {
    const name = renameValue.trim();
    if (name.length === 0) return;
    try {
      await renameFolder(id, name);
      setRenamingId(null);
      refresh();
    } catch {
      // Same fail-soft posture as create — keep the inline editor open.
    }
  }

  async function handleDelete(id: string): Promise<void> {
    await deleteFolder(id);
    if (selectedFolderId === id) onSelect(null);
    refresh();
  }

  function handleNewFolderKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") void handleCreateSubmit();
    if (event.key === "Escape") {
      setCreating(false);
      setNewFolderName("");
    }
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>, id: string): void {
    if (event.key === "Enter") void handleRenameSubmit(id);
    if (event.key === "Escape") setRenamingId(null);
  }

  const newFolderAffordance = creating ? (
    <div className="flex items-center gap-1 px-2 py-1">
      <Input
        autoFocus
        value={newFolderName}
        onChange={(event) => setNewFolderName(event.target.value)}
        onKeyDown={handleNewFolderKeyDown}
        onBlur={() => void handleCreateSubmit()}
        placeholder="Folder name"
        className="h-8"
      />
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setCreating(true)}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-semibold text-muted-foreground hover:bg-muted"
    >
      <Plus className="size-4" aria-hidden="true" />
      New folder
    </button>
  );

  return (
    <nav className="flex w-56 shrink-0 flex-col gap-1">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`rounded-md px-2 py-1.5 text-left text-sm font-semibold ${
          selectedFolderId === null ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
        }`}
      >
        All entries
      </button>

      {folders === null && !loadFailed && (
        <div className="flex flex-col gap-1 px-2 py-1">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      )}

      {loadFailed && (
        <div className="flex flex-col items-start gap-1 px-2 py-1">
          <span className="text-sm text-destructive">Couldn't load folders</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setRetryToken((n) => n + 1)}>
            Retry
          </Button>
        </div>
      )}

      {folders !== null && !loadFailed && (
        <>
          {folders.length === 0 && (
            <p className="px-2 py-1 text-sm text-muted-foreground">No folders yet</p>
          )}

          <ScrollArea className="max-h-96">
            <div className="flex flex-col gap-1 pr-2">
              {folders.map((folder) => {
                const isSelected = folder.id === selectedFolderId;
                const isRenaming = renamingId === folder.id;

                if (isRenaming) {
                  return (
                    <div key={folder.id} className="px-2 py-1">
                      <Input
                        autoFocus
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => handleRenameKeyDown(event, folder.id)}
                        onBlur={() => void handleRenameSubmit(folder.id)}
                        className="h-8"
                      />
                    </div>
                  );
                }

                return (
                  <div
                    key={folder.id}
                    className={`group flex items-center gap-1 rounded-md px-2 py-1.5 ${
                      isSelected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(folder.id)}
                      title={folder.name}
                      className="flex-1 truncate text-left text-sm font-semibold"
                    >
                      {folder.name}
                    </button>
                    <span className="text-xs font-semibold text-muted-foreground">{folder.entryCount}</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Options for ${folder.name}`}
                          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                        >
                          <MoreHorizontal className="size-4" aria-hidden="true" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            setRenameValue(folder.name);
                            setRenamingId(folder.id);
                          }}
                        >
                          Rename
                        </DropdownMenuItem>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem variant="destructive" onSelect={(event) => event.preventDefault()}>
                              Delete
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete folder?</AlertDialogTitle>
                              <AlertDialogDescription>
                                "{folder.name}" will be deleted. Entries inside it will become uncategorized, not deleted.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={(event) => {
                                  event.preventDefault();
                                  void handleDelete(folder.id);
                                }}
                              >
                                Delete folder
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </>
      )}

      {newFolderAffordance}
    </nav>
  );
}
