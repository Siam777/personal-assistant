import { useEffect, useState } from "react";
import { getStatus, lockVault, type VaultStatus } from "./lib/api";
import { installSessionSignals } from "./lib/session-signals";
import InitScreen from "./features/vault-unlock/InitScreen";
import UnlockScreen from "./features/vault-unlock/UnlockScreen";
import LockedNotice from "./features/vault-unlock/LockedNotice";
import TwoFactorSettings from "./features/vault-2fa/TwoFactorSettings";
import EntryListScreen from "./features/vault-entries/EntryListScreen";
import { LensScreen } from "./features/lens/LensScreen";
import { AuditLogModal } from "./features/vault-audit/AuditLogModal";
import { BackupModal } from "./features/vault-backup/BackupModal";
import { Toaster } from "./components/ui/sonner";
import { Button } from "./components/ui/button";
import {
  Shield,
  HardDriveDownload,
  Lock,
  Settings,
  FolderKey,
  ScanText,
} from "lucide-react";

type ActiveModule = "vault" | "lens";
type UnlockedView = "vault" | "settings";

// The client polls GET /api/vault/status on this interval so the UI notices
// a server-side auto-lock without any user action. /status deliberately
// sits outside the timer-arming requireUnlocked middleware, so this polling
// can never itself keep a session alive.
const STATUS_POLL_INTERVAL_MS = 15_000;

export default function App() {
  const [activeModule, setActiveModule] = useState<ActiveModule>("vault");
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlockedView, setUnlockedView] = useState<UnlockedView>("vault");
  const [auditOpen, setAuditOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [entriesVersion, setEntriesVersion] = useState(0);
  const [wasUnlocked, setWasUnlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getStatus()
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load vault status");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const cleanupSignals = installSessionSignals(setStatus);

    const pollId = window.setInterval(() => {
      getStatus()
        .then(setStatus)
        .catch(() => {
          // Best-effort poll only — transient failure ignored
        });
    }, STATUS_POLL_INTERVAL_MS);

    return () => {
      cleanupSignals();
      window.clearInterval(pollId);
    };
  }, []);

  if (status?.unlocked && !wasUnlocked) {
    setWasUnlocked(true);
  }

  async function handleLock() {
    try {
      await lockVault();
      const next = await getStatus();
      setStatus(next);
    } catch {
      // best-effort
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Top Application Header */}
      <header className="border-b bg-card/60 backdrop-blur sticky top-0 z-20 px-6 py-3 flex items-center justify-between gap-4">
        {/* Left: Brand & Module Switcher */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <FolderKey className="size-6 text-primary" />
            <h1 className="text-lg font-bold">Personal Assistant</h1>
          </div>

          <nav className="flex items-center bg-muted/60 p-1 rounded-lg border">
            <button
              type="button"
              onClick={() => setActiveModule("vault")}
              className={`flex items-center gap-1.5 px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                activeModule === "vault"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FolderKey className="size-4" />
              <span>Vault</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveModule("lens")}
              className={`flex items-center gap-1.5 px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                activeModule === "lens"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ScanText className="size-4 text-primary" />
              <span>Lens (OCR)</span>
            </button>
          </nav>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {status?.unlocked && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAuditOpen(true)}
                className="flex items-center gap-1.5"
              >
                <Shield className="size-4 text-primary" />
                <span>Audit Log</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setBackupOpen(true)}
                className="flex items-center gap-1.5"
              >
                <HardDriveDownload className="size-4" />
                <span>Backup & Recovery</span>
              </Button>

              {activeModule === "vault" &&
                (unlockedView === "settings" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setUnlockedView("vault")}
                    className="flex items-center gap-1.5"
                  >
                    <FolderKey className="size-4" />
                    <span>Vault</span>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setUnlockedView("settings")}
                    className="flex items-center gap-1.5"
                  >
                    <Settings className="size-4" />
                    <span>2FA Settings</span>
                  </Button>
                ))}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleLock}
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                title="Lock Vault"
              >
                <Lock className="size-4" />
                <span>Lock</span>
              </Button>
            </>
          )}
        </div>
      </header>

      {/* Main Content View */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
        {activeModule === "lens" ? (
          <LensScreen />
        ) : error ? (
          <div className="p-6 max-w-xl mx-auto">
            <h2 className="text-xl font-bold mb-2">Vault Error</h2>
            <p role="alert" className="text-destructive">{error}</p>
          </div>
        ) : !status ? (
          <div className="p-6 max-w-xl mx-auto">
            <p className="text-muted-foreground">Loading vault status…</p>
          </div>
        ) : !status.initialized ? (
          <div className="max-w-2xl mx-auto">
            <InitScreen onInitialized={setStatus} />
          </div>
        ) : status.unlocked ? (
          unlockedView === "settings" ? (
            <div className="max-w-2xl mx-auto space-y-6">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setUnlockedView("vault")}
                className="mb-2"
              >
                ← Back to vault
              </Button>
              <TwoFactorSettings totpEnabled={status.totpEnabled} onStatusChange={setStatus} />
            </div>
          ) : (
            <EntryListScreen key={entriesVersion} />
          )
        ) : wasUnlocked ? (
          <div className="max-w-xl mx-auto">
            <LockedNotice onReturnToUnlock={() => setWasUnlocked(false)} />
          </div>
        ) : (
          <div className="max-w-xl mx-auto">
            <UnlockScreen totpEnabled={status.totpEnabled} onUnlocked={setStatus} />
          </div>
        )}
      </main>

      <AuditLogModal open={auditOpen} onOpenChange={setAuditOpen} />
      <BackupModal
        open={backupOpen}
        onOpenChange={setBackupOpen}
        onRestored={() => setEntriesVersion((v) => v + 1)}
      />
      <Toaster position="top-right" richColors />
    </div>
  );
}
