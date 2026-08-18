/**
 * Shown when a previously unlocked session has locked itself — the idle
 * timer fired, or a page-lifecycle signal proactively locked the vault. A
 * brief statement plus a control back to `UnlockScreen`. Renders no vault
 * content of any kind.
 */

interface LockedNoticeProps {
  onReturnToUnlock: () => void;
}

export default function LockedNotice({ onReturnToUnlock }: LockedNoticeProps) {
  return (
    <section role="status">
      <h2>Vault locked</h2>
      <p>Your vault locked automatically after a period of inactivity.</p>
      <button type="button" onClick={onReturnToUnlock}>
        Unlock again
      </button>
    </section>
  );
}
