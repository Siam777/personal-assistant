/**
 * Shows the current 2FA state (from `GET /api/vault/status`, held by the
 * parent). When off, offers a control to start enrollment. When on, offers
 * a control to disable and a control to regenerate backup codes, both
 * routed through `DisableWithReauthScreen`'s master-password
 * re-authentication. Never displays the secret or any stored backup code
 * outside the one-time enrollment/regeneration response.
 */

import { useState } from "react";
import {
  disableTwoFactor,
  getStatus,
  regenerateBackupCodes,
  type VaultStatus,
} from "../../lib/api";
import BackupCodesPanel from "./BackupCodesPanel";
import DisableWithReauthScreen from "./DisableWithReauthScreen";
import EnrollScreen from "./EnrollScreen";

interface TwoFactorSettingsProps {
  totpEnabled: boolean;
  onStatusChange: (status: VaultStatus) => void;
}

type Mode = "idle" | "enrolling" | "disabling" | "regenerating" | "showing-new-codes";

export default function TwoFactorSettings({
  totpEnabled,
  onStatusChange,
}: TwoFactorSettingsProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [regeneratedCodes, setRegeneratedCodes] = useState<string[] | null>(null);

  function refreshStatus(): void {
    getStatus()
      .then(onStatusChange)
      .catch(() => {
        // Best-effort refresh only — the parent's own status poll (<=15s)
        // still catches up if this one-off fetch fails.
      });
  }

  if (mode === "enrolling") {
    return (
      <EnrollScreen
        onEnrolled={() => {
          setMode("idle");
          refreshStatus();
        }}
        onCancel={() => setMode("idle")}
      />
    );
  }

  if (mode === "disabling") {
    return (
      <DisableWithReauthScreen
        action="disable"
        onSubmit={disableTwoFactor}
        onDone={() => {
          setMode("idle");
          refreshStatus();
        }}
        onCancel={() => setMode("idle")}
      />
    );
  }

  if (mode === "regenerating") {
    return (
      <DisableWithReauthScreen
        action="regenerate"
        onSubmit={async (masterPassword) => {
          const result = await regenerateBackupCodes(masterPassword);
          setRegeneratedCodes(result.backupCodes);
        }}
        onDone={() => setMode("showing-new-codes")}
        onCancel={() => setMode("idle")}
      />
    );
  }

  if (mode === "showing-new-codes" && regeneratedCodes) {
    return (
      <BackupCodesPanel
        codes={regeneratedCodes}
        onContinue={() => {
          setRegeneratedCodes(null);
          setMode("idle");
        }}
      />
    );
  }

  return (
    <section>
      <h2>Two-factor authentication</h2>
      {totpEnabled ? (
        <>
          <p>Two-factor authentication is on.</p>
          <button type="button" onClick={() => setMode("regenerating")}>
            Regenerate backup codes
          </button>
          <button type="button" onClick={() => setMode("disabling")}>
            Disable two-factor authentication
          </button>
        </>
      ) : (
        <>
          <p>Two-factor authentication is off.</p>
          <button type="button" onClick={() => setMode("enrolling")}>
            Enable two-factor authentication
          </button>
        </>
      )}
    </section>
  );
}
