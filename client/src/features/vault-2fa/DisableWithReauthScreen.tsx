/**
 * Master-password re-authentication gate for disabling 2FA or regenerating
 * backup codes (D-06, T-04-05). An already-unlocked session is deliberately
 * not sufficient on its own — the threat here is someone reaching a machine
 * left unlocked, and re-authentication is what stops them turning the
 * second factor off. The password field carries `autoComplete="current-password"`
 * inside a form carrying `autoComplete="off"`, renders the server's generic
 * message unchanged on failure, and clears the field on both outcomes. The
 * password value is never written to any Web Storage API.
 */

import { useState, type FormEvent } from "react";
import { ApiError } from "../../lib/api";

type ReauthAction = "disable" | "regenerate";

interface DisableWithReauthScreenProps {
  action: ReauthAction;
  onSubmit: (masterPassword: string) => Promise<void>;
  onDone: () => void;
  onCancel: () => void;
}

const COPY: Record<
  ReauthAction,
  { heading: string; description: string; submitLabel: string }
> = {
  disable: {
    heading: "Disable two-factor authentication",
    description:
      "This turns off the authenticator-code requirement on unlock. Once disabled, the master password alone unlocks the vault again. Re-enter your master password to confirm.",
    submitLabel: "Disable two-factor authentication",
  },
  regenerate: {
    heading: "Regenerate backup codes",
    description:
      "This replaces your existing backup codes with a new set of ten — every previous backup code stops working immediately. Re-enter your master password to confirm.",
    submitLabel: "Regenerate backup codes",
  },
};

export default function DisableWithReauthScreen({
  action,
  onSubmit,
  onDone,
  onCancel,
}: DisableWithReauthScreenProps) {
  const [masterPassword, setMasterPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Renders exactly the server's own generic message — no client-side
  // interpretation of which check failed.
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const copy = COPY[action];

  const canSubmit = masterPassword.length > 0 && !submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setServerMessage(null);

    try {
      await onSubmit(masterPassword);
      setMasterPassword("");
      onDone();
    } catch (err) {
      setMasterPassword("");
      setServerMessage(
        err instanceof ApiError ? err.message : "Failed to confirm master password"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2>{copy.heading}</h2>
      <p>{copy.description}</p>
      <form onSubmit={(event) => void handleSubmit(event)} autoComplete="off">
        <div>
          <label htmlFor="reauth-master-password">Master password</label>
          <br />
          <input
            id="reauth-master-password"
            type="password"
            autoComplete="current-password"
            value={masterPassword}
            onChange={(event) => setMasterPassword(event.target.value)}
          />
        </div>

        {serverMessage && <p role="alert">{serverMessage}</p>}

        <button type="submit" disabled={!canSubmit}>
          {submitting ? "Confirming…" : copy.submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </form>
    </section>
  );
}
