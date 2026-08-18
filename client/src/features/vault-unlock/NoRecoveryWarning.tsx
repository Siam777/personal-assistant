/**
 * Non-closable, unmissable no-recovery acknowledgement (D-05). This panel
 * offers no way to make it go away or move past it other than reading it
 * and ticking the checkbox — the parent form still gates its own submit
 * button on that state.
 */

interface NoRecoveryWarningProps {
  acknowledged: boolean;
  onAcknowledgedChange: (acknowledged: boolean) => void;
}

export default function NoRecoveryWarning({
  acknowledged,
  onAcknowledgedChange,
}: NoRecoveryWarningProps) {
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
        There is no password reset. Losing this password means losing all data.
      </p>
      <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", marginTop: "0.75rem" }}>
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => {
            onAcknowledgedChange(event.target.checked);
          }}
        />
        <span>
          I understand there is no password recovery. If I lose this password, everything
          in the vault is permanently unrecoverable.
        </span>
      </label>
    </section>
  );
}
