import { useEffect, useState } from "react";
import { getStatus, type VaultStatus } from "./lib/api";
import { installSessionSignals } from "./lib/session-signals";
import InitScreen from "./features/vault-unlock/InitScreen";
import UnlockScreen from "./features/vault-unlock/UnlockScreen";
import LockedNotice from "./features/vault-unlock/LockedNotice";
import TwoFactorSettings from "./features/vault-2fa/TwoFactorSettings";
import EntryListScreen from "./features/vault-entries/EntryListScreen";

/** The only two views reachable once the vault is unlocked. `settings` is
 * gated entirely by being nested inside the `status.unlocked` branch below —
 * there is no route that reaches it while the vault is locked. */
type UnlockedView = "vault" | "settings";

// The client polls GET /api/vault/status on this interval so the UI notices
// a server-side auto-lock without any user action. /status deliberately
// sits outside the timer-arming requireUnlocked middleware, so this polling
// can never itself keep a session alive.
const STATUS_POLL_INTERVAL_MS = 15_000;

/**
 * Fetches vault status on mount and routes between the first-run creation
 * screen, the unlock screen, and the unlocked panel. Also installs the
 * browser session-lifecycle signals (accelerant-only, see
 * lib/session-signals.ts) and polls status so a server-side auto-lock is
 * reflected in the UI even if the user never touches the page again.
 */
export default function App() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlockedView, setUnlockedView] = useState<UnlockedView>("vault");
  // Tracks whether the vault was seen unlocked at some point, so a poll
  // that flips unlocked -> locked can route to LockedNotice instead of
  // silently reusing UnlockScreen (the user should understand what
  // happened, not just see a blank re-prompt). Deliberately state, not a
  // ref (WR-01): "Unlock again" needs to schedule a re-render the moment
  // it fires, not wait for the next unrelated poll/visibility event to
  // happen to re-render this component.
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
          // Best-effort poll only — a transient failure here should not
          // tear down the UI; the next tick tries again.
        });
    }, STATUS_POLL_INTERVAL_MS);

    return () => {
      cleanupSignals();
      window.clearInterval(pollId);
    };
  }, []);

  // A guarded render-phase state update: only calls the setter on the
  // transition into "seen unlocked", so this does not loop — once
  // `wasUnlocked` is true, the condition is false on every subsequent
  // render until `onReturnToUnlock` resets it.
  if (status?.unlocked && !wasUnlocked) {
    setWasUnlocked(true);
  }

  if (error) {
    return (
      <main>
        <h1>Personal Assistant — Vault</h1>
        <p role="alert">Error: {error}</p>
      </main>
    );
  }

  if (!status) {
    return (
      <main>
        <h1>Personal Assistant — Vault</h1>
        <p>Loading vault status…</p>
      </main>
    );
  }

  if (!status.initialized) {
    return (
      <main>
        <h1>Personal Assistant — Vault</h1>
        <InitScreen onInitialized={setStatus} />
      </main>
    );
  }

  if (status.unlocked) {
    return (
      <main>
        <h1>Personal Assistant — Vault</h1>
        {unlockedView === "settings" ? (
          <>
            <button type="button" onClick={() => setUnlockedView("vault")}>
              Back to vault
            </button>
            <TwoFactorSettings totpEnabled={status.totpEnabled} onStatusChange={setStatus} />
          </>
        ) : (
          <>
            <EntryListScreen />
            <button type="button" onClick={() => setUnlockedView("settings")}>
              Two-factor authentication settings
            </button>
          </>
        )}
      </main>
    );
  }

  if (wasUnlocked) {
    return (
      <main>
        <h1>Personal Assistant — Vault</h1>
        <LockedNotice onReturnToUnlock={() => setWasUnlocked(false)} />
      </main>
    );
  }

  return (
    <main>
      <h1>Personal Assistant — Vault</h1>
      <UnlockScreen totpEnabled={status.totpEnabled} onUnlocked={setStatus} />
    </main>
  );
}
