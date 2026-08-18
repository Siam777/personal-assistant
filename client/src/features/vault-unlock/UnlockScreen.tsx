/**
 * Single-step unlock form. Renders the master-password field and, only
 * when the status reports `totpEnabled`, a second-factor field alongside it
 * from the start — never revealed after a "password accepted" round trip.
 * Both fields submit together in one `POST /api/vault/unlock` request.
 * Rendering the second field up front (rather than after a first successful
 * step) is a security requirement: a two-step flow would let a caller learn
 * whether a password was correct by whether a second step appears, turning
 * the unlock endpoint into a password-guessing oracle.
 *
 * The password value lives in component state for the lifetime of this
 * form only, is cleared on both success and failure, and is never written
 * to any Web Storage API, URL, query parameter, or fragment.
 */

import { useState, type FormEvent } from "react";
import { ApiError, unlockVault, type VaultStatus } from "../../lib/api";

interface UnlockScreenProps {
  totpEnabled: boolean;
  onUnlocked: (status: VaultStatus) => void;
}

export default function UnlockScreen({ totpEnabled, onUnlocked }: UnlockScreenProps) {
  const [masterPassword, setMasterPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Renders exactly the server's own generic message — no client-side
  // interpretation, no password-specific troubleshooting hint that would
  // re-introduce the distinction the server deliberately removed.
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const canSubmit = masterPassword.length > 0 && !submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setServerMessage(null);

    try {
      const status = await unlockVault(
        masterPassword,
        totpEnabled && totpCode.length > 0 ? totpCode : undefined
      );
      setMasterPassword("");
      setTotpCode("");
      onUnlocked(status);
    } catch (err) {
      setMasterPassword("");
      setTotpCode("");
      setServerMessage(
        err instanceof ApiError ? err.message : "Failed to unlock vault"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2>Unlock your vault</h2>
      <form onSubmit={(event) => void handleSubmit(event)} autoComplete="off">
        <div>
          <label htmlFor="unlock-master-password">Master password</label>
          <br />
          <input
            id="unlock-master-password"
            type="password"
            autoComplete="current-password"
            value={masterPassword}
            onChange={(event) => setMasterPassword(event.target.value)}
          />
        </div>

        {totpEnabled && (
          <div>
            <label htmlFor="unlock-totp-code">Authenticator code</label>
            <br />
            <input
              id="unlock-totp-code"
              type="text"
              inputMode="text"
              autoComplete="off"
              size={12}
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value)}
            />
            <p>
              Enter the six-digit code from your authenticator app, or one of your
              backup codes if you don&apos;t have access to it.
            </p>
          </div>
        )}

        {serverMessage && <p role="alert">{serverMessage}</p>}

        <button type="submit" disabled={!canSubmit}>
          {submitting ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </section>
  );
}
