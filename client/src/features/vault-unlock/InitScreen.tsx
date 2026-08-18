/**
 * First-run master-password creation form. Renders the password field
 * twice with a confirmation-match check, a live client-side strength
 * indicator (feedback only — the server rescores authoritatively), the
 * non-dismissible no-recovery warning, and a submit button gated on all
 * three conditions. The password value lives in component state for the
 * lifetime of this form only and is never written to any Web Storage API.
 */

import { useMemo, useState, type FormEvent } from "react";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as zxcvbnCommonPackage from "@zxcvbn-ts/language-common";
import * as zxcvbnEnPackage from "@zxcvbn-ts/language-en";
import { initVault, WeakPasswordError, type VaultStatus } from "../../lib/api";
import NoRecoveryWarning from "./NoRecoveryWarning";

// Mirrors server/src/config.ts's MIN_PASSWORD_SCORE. This only gates the
// submit button and gives live feedback before a round trip — the server
// rescores authoritatively on every submission regardless of this value.
const MIN_PASSWORD_SCORE = 3;

const zxcvbn = new ZxcvbnFactory({
  translations: zxcvbnEnPackage.translations,
  graphs: zxcvbnCommonPackage.adjacencyGraphs,
  dictionary: {
    ...zxcvbnCommonPackage.dictionary,
    ...zxcvbnEnPackage.dictionary,
  },
});

interface InitScreenProps {
  onInitialized: (status: VaultStatus) => void;
}

export default function InitScreen({ onInitialized }: InitScreenProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverFeedback, setServerFeedback] = useState<string | null>(null);
  const [genericError, setGenericError] = useState<string | null>(null);

  const strength = useMemo(
    () => (password.length > 0 ? zxcvbn.check(password) : null),
    [password]
  );
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const meetsStrength = strength !== null && strength.score >= MIN_PASSWORD_SCORE;
  const canSubmit = passwordsMatch && meetsStrength && acknowledged && !submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setServerFeedback(null);
    setGenericError(null);

    try {
      const status = await initVault(password, true);
      onInitialized(status);
    } catch (err) {
      if (err instanceof WeakPasswordError && err.feedback) {
        setServerFeedback(err.feedback);
      } else {
        setGenericError(err instanceof Error ? err.message : "Failed to create vault");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2>Create your vault</h2>
      <form onSubmit={(event) => void handleSubmit(event)} autoComplete="off">
        <div>
          <label htmlFor="master-password">Master password</label>
          <br />
          <input
            id="master-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="confirm-password">Confirm master password</label>
          <br />
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </div>

        {password.length > 0 && (
          <p aria-live="polite">
            Strength: {strength?.score ?? 0} / 4
            {!meetsStrength && " — choose a longer, less predictable password"}
          </p>
        )}
        {password.length > 0 && confirmPassword.length > 0 && !passwordsMatch && (
          <p role="alert">Passwords do not match.</p>
        )}

        <NoRecoveryWarning acknowledged={acknowledged} onAcknowledgedChange={setAcknowledged} />

        {serverFeedback && <p role="alert">{serverFeedback}</p>}
        {genericError && <p role="alert">{genericError}</p>}

        <button type="submit" disabled={!canSubmit}>
          {submitting ? "Creating vault…" : "Create vault"}
        </button>
      </form>
    </section>
  );
}
