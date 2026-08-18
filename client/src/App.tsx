import { useEffect, useState } from "react";
import { getStatus, type VaultStatus } from "./lib/api";

/**
 * Fetches vault status on mount and renders the fields as plain text — the
 * thin end of the Walking Skeleton's tracer slice. Plan 01-02 turns this
 * into the router with real init/unlock screens.
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

  return (
    <main>
      <h1>Personal Assistant — Vault</h1>
      {error && <p role="alert">Error: {error}</p>}
      {!error && !status && <p>Loading vault status…</p>}
      {status && (
        <dl>
          <dt>Initialized</dt>
          <dd>{String(status.initialized)}</dd>
          <dt>Unlocked</dt>
          <dd>{String(status.unlocked)}</dd>
          <dt>TOTP enabled</dt>
          <dd>{String(status.totpEnabled)}</dd>
          <dt>Idle timeout (ms)</dt>
          <dd>{status.idleTimeoutMs}</dd>
        </dl>
      )}
    </main>
  );
}
