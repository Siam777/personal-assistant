import { useEffect, useState } from "react";
import { getStatus, type VaultStatus } from "./lib/api";
import InitScreen from "./features/vault-unlock/InitScreen";

/**
 * Fetches vault status on mount and routes between the first-run creation
 * screen and an unlocked placeholder panel. Plan 01-03 replaces the
 * placeholder with the real unlock and locked-state screens.
 */
export default function App() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        <p>Vault unlocked. (The real unlocked view lands in Plan 01-03.)</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Personal Assistant — Vault</h1>
      <p>Vault is locked. (The real unlock screen lands in Plan 01-03.)</p>
    </main>
  );
}
