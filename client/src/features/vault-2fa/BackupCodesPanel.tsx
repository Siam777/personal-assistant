/**
 * Displays the ten backup codes exactly once. States plainly that they are
 * shown once and cannot be retrieved later, offers a copy-to-clipboard
 * control and a download-as-text-file control, and requires an explicit
 * acknowledgement checkbox before the continue control becomes enabled.
 * There is no way to leave this screen without acknowledging — the same
 * discipline as `NoRecoveryWarning`, and for the same reason: these codes
 * are the user's only escape hatch if the authenticator device is lost, and
 * D-05 provides no other recovery. Once continued, the codes are gone from
 * this component's state and there is no path back to them.
 */

import { useState } from "react";
import { copyToClipboard } from "../../lib/clipboard";

interface BackupCodesPanelProps {
  codes: string[];
  onContinue: () => void;
}

export default function BackupCodesPanel({ codes, onContinue }: BackupCodesPanelProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  async function handleCopy(): Promise<void> {
    const success = await copyToClipboard(codes.join("\n"), {
      label: "Backup codes",
      isSecret: true,
    });
    if (success) {
      setCopyStatus("Copied to clipboard (auto-clears in 30s).");
    } else {
      setCopyStatus("Could not copy automatically — select and copy the codes below.");
    }
  }

  function handleDownload(): void {
    const blob = new Blob([codes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "vault-backup-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section
      role="alert"
      aria-live="assertive"
      style={{
        border: "3px solid #b00020",
        borderRadius: 8,
        padding: "1rem 1.25rem",
        margin: "1rem 0",
        background: "#fff4f4",
      }}
    >
      <p style={{ fontWeight: 700, color: "#b00020", margin: 0 }}>
        Save these backup codes now. They are shown once, right now, and can never be
        shown again.
      </p>
      <p>
        Each code unlocks the vault once, in place of an authenticator code, if you ever
        lose access to your authenticator app.
      </p>
      <ul
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "0.5rem",
          listStyle: "none",
          padding: 0,
          fontFamily: "monospace",
          fontSize: "1.1rem",
        }}
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
        <button type="button" onClick={handleCopy}>
          Copy to clipboard
        </button>
        <button type="button" onClick={handleDownload}>
          Download as text file
        </button>
      </div>
      {copyStatus && <p aria-live="polite">{copyStatus}</p>}
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "0.5rem",
          marginTop: "0.75rem",
        }}
      >
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => {
            setAcknowledged(event.target.checked);
          }}
        />
        <span>
          I have saved these backup codes somewhere safe. I understand they will not be
          shown again.
        </span>
      </label>
      <button
        type="button"
        disabled={!acknowledged}
        onClick={onContinue}
        style={{ marginTop: "0.75rem" }}
      >
        Continue
      </button>
    </section>
  );
}
