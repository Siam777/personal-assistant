import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAuditLogs, type AuditLog } from "../../lib/api";
import { RefreshCw, Shield, AlertCircle } from "lucide-react";

interface AuditLogModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EVENT_TYPE_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  vault_unlocked: { label: "Vault Unlocked", variant: "default" },
  vault_locked: { label: "Vault Locked", variant: "secondary" },
  secret_revealed: { label: "Secret Revealed", variant: "outline" },
  secret_copied: { label: "Secret Copied", variant: "secondary" },
  entry_created: { label: "Entry Created", variant: "default" },
  entry_viewed: { label: "Entry Viewed", variant: "outline" },
  entry_updated: { label: "Entry Updated", variant: "secondary" },
  entry_deleted: { label: "Entry Deleted", variant: "destructive" },
  two_factor_enabled: { label: "2FA Enabled", variant: "default" },
  two_factor_disabled: { label: "2FA Disabled", variant: "destructive" },
  backup_codes_regenerated: { label: "Backup Codes Reset", variant: "outline" },
  backup_exported: { label: "Backup Exported", variant: "default" },
  backup_restored: { label: "Backup Restored", variant: "default" },
};

function formatEventBadge(eventType: string) {
  const info = EVENT_TYPE_LABELS[eventType] ?? { label: eventType, variant: "outline" };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}

function formatTimestamp(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export function AuditLogModal({ open, onOpenChange }: AuditLogModalProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  async function loadLogs(reset = false) {
    setLoading(true);
    const targetOffset = reset ? 0 : offset;
    try {
      const eventTypeParam = filter === "all" ? undefined : filter;
      const res = await getAuditLogs({
        limit,
        offset: targetOffset,
        eventType: eventTypeParam,
      });
      if (reset) {
        setLogs(res.logs);
        setOffset(limit);
      } else {
        setLogs((prev) => [...prev, ...res.logs]);
        setOffset((prev) => prev + limit);
      }
      setTotal(res.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      void loadLogs(true);
    } else {
      setLogs([]);
      setOffset(0);
    }
  }, [open, filter]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Shield className="size-5 text-primary" />
            <DialogTitle>Security Audit Log</DialogTitle>
          </div>
          <DialogDescription>
            Append-only record of all vault operations, secret access, and lifecycle events.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4 py-2 border-b">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Filter:</span>
            <Select value={filter} onValueChange={(val) => setFilter(val)}>
              <SelectTrigger className="w-[180px] h-8 text-sm">
                <SelectValue placeholder="All Events" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Events</SelectItem>
                <SelectItem value="vault_unlocked">Vault Unlocked</SelectItem>
                <SelectItem value="vault_locked">Vault Locked</SelectItem>
                <SelectItem value="secret_copied">Secret Copied</SelectItem>
                <SelectItem value="secret_revealed">Secret Revealed</SelectItem>
                <SelectItem value="entry_created">Entry Created</SelectItem>
                <SelectItem value="entry_updated">Entry Updated</SelectItem>
                <SelectItem value="entry_deleted">Entry Deleted</SelectItem>
                <SelectItem value="backup_exported">Backup Exported</SelectItem>
                <SelectItem value="backup_restored">Backup Restored</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {total} total event{total === 1 ? "" : "s"}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadLogs(true)}
              disabled={loading}
            >
              <RefreshCw className={`size-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-[300px] space-y-2 py-2 pr-1">
          {logs.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-center">
              <AlertCircle className="size-8 mb-2 opacity-50" />
              <p className="text-sm">No audit logs found</p>
            </div>
          )}

          {logs.map((log) => {
            const detailText = log.details
              ? typeof log.details === "object"
                ? Object.entries(log.details)
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join(", ")
                : String(log.details)
              : null;

            return (
              <div
                key={log.id}
                className="flex items-start justify-between gap-4 p-2.5 rounded-lg border text-sm hover:bg-muted/40 transition-colors"
              >
                <div className="flex flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {formatEventBadge(log.eventType)}
                    {log.entryName && (
                      <span className="font-medium text-foreground truncate max-w-[200px]">
                        {log.entryName}
                      </span>
                    )}
                    {log.entryType && (
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {log.entryType}
                      </span>
                    )}
                  </div>

                  {detailText && (
                    <p className="text-xs text-muted-foreground break-all">{detailText}</p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <div className="text-xs text-muted-foreground">
                    {formatTimestamp(log.createdAt)}
                  </div>
                  {log.ipAddress && (
                    <div className="text-[11px] text-muted-foreground/70 font-mono">
                      {log.ipAddress}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {loading && (
            <div className="space-y-2 py-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {logs.length < total && !loading && (
            <div className="pt-2 text-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void loadLogs(false)}
              >
                Load More Events
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
