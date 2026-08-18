/**
 * Browser page-lifecycle hooks that proactively lock the vault when the tab
 * is closing or backgrounding. This file is a UX accelerant ONLY — never
 * the enforcement point. The server's own idle timer (server/src/modules/
 * auth/session.ts) is the actual security guarantee: it runs independently
 * of any client signal and still fires even if the browser tab never sends
 * any of the events below (crashed tab, killed process, network drop before
 * `pagehide` fires). Do not treat anything in this file as a substitute for
 * that server-side timer (D-04, 01-RESEARCH.md Architecture Pattern 5).
 */

import { getStatus, lockVault, type VaultStatus } from "./api";

/**
 * Registers `pagehide` and `visibilitychange` handlers:
 *  - the page becoming hidden, or going away entirely, fires `POST
 *    /api/vault/lock` with `keepalive: true` so the request has a chance to
 *    complete even as the page unloads;
 *  - the page becoming visible again re-fetches `GET /api/vault/status` and
 *    reports it through `onStatusChange`, so a returning user immediately
 *    sees whether the server's own idle timer locked the vault while the
 *    tab was away — this does not itself lock or unlock anything.
 *
 * Returns a cleanup function that removes both listeners.
 */
export function installSessionSignals(
  onStatusChange: (status: VaultStatus) => void
): () => void {
  function handleVisibilityOrHide(): void {
    if (document.visibilityState === "hidden") {
      void lockVault();
    } else {
      getStatus()
        .then(onStatusChange)
        .catch(() => {
          // Best-effort refresh only — the next scheduled poll (or the
          // user's own next action) will pick up the current state.
        });
    }
  }

  function handlePageHide(): void {
    void lockVault();
  }

  document.addEventListener("visibilitychange", handleVisibilityOrHide);
  window.addEventListener("pagehide", handlePageHide);

  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityOrHide);
    window.removeEventListener("pagehide", handlePageHide);
  };
}
