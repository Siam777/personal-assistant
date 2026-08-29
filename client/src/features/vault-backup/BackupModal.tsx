import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Download, Upload, ShieldCheck, AlertTriangle } from "lucide-react";
import { exportBackup, restoreBackup } from "../../lib/api";

interface BackupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored?: () => void;
}

export function BackupModal({ open, onOpenChange, onRestored }: BackupModalProps) {
  const [activeTab, setActiveTab] = useState<"export" | "restore">("export");

  // Export State
  const [exportPassword, setExportPassword] = useState("");
  const [exportPasswordConfirm, setExportPasswordConfirm] = useState("");
  const [exporting, setExporting] = useState(false);

  // Restore State
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePassword, setRestorePassword] = useState("");
  const [restoreMode, setRestoreMode] = useState<"merge" | "overwrite">("merge");
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false);
  const [restoring, setRestoring] = useState(false);

  async function handleExport(e: React.FormEvent) {
    e.preventDefault();
    if (!exportPassword) {
      toast.error("Please enter a backup encryption password");
      return;
    }
    if (exportPassword !== exportPasswordConfirm) {
      toast.error("Passwords do not match");
      return;
    }

    setExporting(true);
    try {
      const container = await exportBackup(exportPassword);
      const dateStr = new Date().toISOString().split("T")[0];
      const filename = `vault-backup-${dateStr}.vaultbackup`;

      const blob = new Blob([JSON.stringify(container, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);

      toast.success("Backup downloaded successfully", {
        description: `Saved as ${filename}`,
      });
      setExportPassword("");
      setExportPasswordConfirm("");
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Backup export failed");
    } finally {
      setExporting(false);
    }
  }

  async function handleRestore(e: React.FormEvent) {
    e.preventDefault();
    if (!restoreFile) {
      toast.error("Please select a .vaultbackup file");
      return;
    }
    if (!restorePassword) {
      toast.error("Please enter the backup decryption password");
      return;
    }
    if (restoreMode === "overwrite" && !overwriteConfirmed) {
      toast.error("Please confirm overwriting the vault");
      return;
    }

    setRestoring(true);
    try {
      const fileText = await restoreFile.text();
      const backupData = JSON.parse(fileText);

      const result = await restoreBackup(backupData, restorePassword, restoreMode);

      toast.success(
        `Successfully restored ${result.restoredCount} entries (${result.mode} mode)`
      );
      setRestoreFile(null);
      setRestorePassword("");
      setOverwriteConfirmed(false);
      onOpenChange(false);
      onRestored?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Backup restore failed");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            <DialogTitle>Backup & Recovery</DialogTitle>
          </div>
          <DialogDescription>
            Export encrypted backups of your vault or restore from an existing backup.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as "export" | "restore")}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="export" className="flex items-center gap-2">
              <Download className="size-4" />
              Export Backup
            </TabsTrigger>
            <TabsTrigger value="restore" className="flex items-center gap-2">
              <Upload className="size-4" />
              Restore Backup
            </TabsTrigger>
          </TabsList>

          {/* Export Tab */}
          <TabsContent value="export" className="space-y-4 pt-4">
            <div className="p-3 bg-muted/60 rounded-lg text-xs text-muted-foreground flex items-start gap-2">
              <ShieldCheck className="size-4 text-primary shrink-0 mt-0.5" />
              <span>
                Backups are encrypted using <strong>AES-256-GCM</strong> and <strong>Argon2id</strong>.
                Choose a strong password. Without this password, the backup file cannot be recovered.
              </span>
            </div>

            <form onSubmit={handleExport} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="export-pass">Backup Password</Label>
                <Input
                  id="export-pass"
                  type="password"
                  value={exportPassword}
                  onChange={(e) => setExportPassword(e.target.value)}
                  placeholder="Enter a strong password for this backup"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="export-pass-confirm">Confirm Backup Password</Label>
                <Input
                  id="export-pass-confirm"
                  type="password"
                  value={exportPasswordConfirm}
                  onChange={(e) => setExportPasswordConfirm(e.target.value)}
                  placeholder="Confirm password"
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={exporting}>
                <Download className="size-4 mr-2" />
                {exporting ? "Encrypting & Exporting..." : "Download Encrypted Backup (.vaultbackup)"}
              </Button>
            </form>
          </TabsContent>

          {/* Restore Tab */}
          <TabsContent value="restore" className="space-y-4 pt-4">
            <form onSubmit={handleRestore} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="backup-file">Select Backup File</Label>
                <Input
                  id="backup-file"
                  type="file"
                  accept=".vaultbackup,.json"
                  onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="restore-pass">Decryption Password</Label>
                <Input
                  id="restore-pass"
                  type="password"
                  value={restorePassword}
                  onChange={(e) => setRestorePassword(e.target.value)}
                  placeholder="Enter password used when exporting this backup"
                  required
                />
              </div>

              <div className="space-y-2 pt-1">
                <Label>Restore Mode</Label>
                <div className="grid grid-cols-1 gap-2 pt-1">
                  <label className="flex items-start space-x-2 border rounded-lg p-3 hover:bg-muted/30 cursor-pointer">
                    <input
                      type="radio"
                      name="restoreMode"
                      value="merge"
                      checked={restoreMode === "merge"}
                      onChange={() => setRestoreMode("merge")}
                      className="mt-1"
                    />
                    <div className="space-y-0.5">
                      <span className="text-sm font-medium">Merge (Recommended)</span>
                      <p className="text-xs text-muted-foreground">
                        Adds new entries and updates matching ones without deleting existing items.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start space-x-2 border border-destructive/30 rounded-lg p-3 hover:bg-destructive/5 cursor-pointer">
                    <input
                      type="radio"
                      name="restoreMode"
                      value="overwrite"
                      checked={restoreMode === "overwrite"}
                      onChange={() => setRestoreMode("overwrite")}
                      className="mt-1"
                    />
                    <div className="space-y-0.5">
                      <span className="text-sm font-medium text-destructive">
                        Overwrite Entire Vault
                      </span>
                      <p className="text-xs text-muted-foreground">
                        Wipes all existing vault entries and replaces them with this backup.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {restoreMode === "overwrite" && (
                <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-xs flex items-start gap-2">
                  <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold text-destructive">Destructive Action</p>
                    <label className="flex items-center gap-2 cursor-pointer pt-1 text-foreground">
                      <input
                        type="checkbox"
                        checked={overwriteConfirmed}
                        onChange={(e) => setOverwriteConfirmed(e.target.checked)}
                        className="rounded"
                      />
                      <span>I understand all current vault data will be permanently replaced</span>
                    </label>
                  </div>
                </div>
              )}

              <Button
                type="submit"
                variant={restoreMode === "overwrite" ? "destructive" : "default"}
                className="w-full"
                disabled={restoring || (restoreMode === "overwrite" && !overwriteConfirmed)}
              >
                <Upload className="size-4 mr-2" />
                {restoring ? "Decrypting & Restoring..." : "Restore Vault"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
