/**
 * Calls the enroll endpoint, renders the returned QR code and base32
 * secret, and collects the confirmation code from the authenticator app.
 * Two-factor authentication is not on yet — scanning the code alone
 * changes nothing (T-04-08); it only turns on once the confirmation code
 * below is accepted. On success, hands the returned backup codes to
 * `BackupCodesPanel`; this screen only reports completion to its parent
 * after those codes have been acknowledged.
 */

import { useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  beginTwoFactorEnrollment,
  confirmTwoFactorEnrollment,
  type EnrollmentStart,
} from "../../lib/api";
import BackupCodesPanel from "./BackupCodesPanel";

interface EnrollScreenProps {
  onEnrolled: () => void;
  onCancel: () => void;
}

export default function EnrollScreen({ onEnrolled, onCancel }: EnrollScreenProps) {
  const [enrollment, setEnrollment] = useState<EnrollmentStart | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    beginTwoFactorEnrollment()
      .then((result) => {
        if (!cancelled) setEnrollment(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(
            err instanceof ApiError ? err.message : "Failed to start enrollment"
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (backupCodes) {
    return (
      <BackupCodesPanel
        codes={backupCodes}
        onContinue={() => {
          setBackupCodes(null);
          onEnrolled();
        }}
      />
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!enrollment || code.length === 0 || submitting) return;

    setSubmitting(true);
    setServerMessage(null);

    try {
      const result = await confirmTwoFactorEnrollment(enrollment.enrollmentId, code);
      setCode("");
      setBackupCodes(result.backupCodes);
    } catch (err) {
      setCode("");
      setServerMessage(
        err instanceof ApiError ? err.message : "Failed to confirm enrollment"
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <section>
        <p role="alert">{loadError}</p>
        <button type="button" onClick={onCancel}>
          Back
        </button>
      </section>
    );
  }

  if (!enrollment) {
    return <p>Preparing your authenticator setup…</p>;
  }

  return (
    <section>
      <h2>Set up two-factor authentication</h2>
      <p>
        Two-factor authentication is <strong>not on yet</strong>. Scanning this code
        alone changes nothing — it only turns on once you confirm it below with a code
        from your authenticator app.
      </p>
      <img
        src={enrollment.qrDataUrl}
        alt="QR code for your authenticator app — scan it with an app such as Google Authenticator or Authy to add this vault"
        width={200}
        height={200}
      />
      <p>
        Can&apos;t scan? Enter this key manually in your authenticator app:{" "}
        <code style={{ userSelect: "all" }}>{enrollment.secret}</code>
      </p>
      <form onSubmit={(event) => void handleSubmit(event)} autoComplete="off">
        <div>
          <label htmlFor="twofa-confirm-code">Code from your authenticator app</label>
          <br />
          <input
            id="twofa-confirm-code"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            size={8}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </div>

        {serverMessage && <p role="alert">{serverMessage}</p>}

        <button type="submit" disabled={code.length === 0 || submitting}>
          {submitting ? "Confirming…" : "Confirm and turn on"}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </form>
    </section>
  );
}
