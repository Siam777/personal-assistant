# Phase 3: Trust, Backup & Recovery - UI Design Contract

## Screens and Modals

### 1. Audit Log Viewer (`AuditLogModal` / `AuditLogView`)
- Accessible from top navigation header / user settings menu via button with shield/clock icon ("Audit Log").
- Header: "Vault Audit Log" with subtitle "Chronological record of vault access and modifications. Secrets are never logged."
- Controls:
  - Event filter dropdown: All Events, Unlocks/Locks, Entry Changes, Secret Access, Backups, 2FA.
  - Refresh button.
- List view:
  - Each item displays:
    - Event badge / icon (color-coded: blue for view/reveal, green for create/restore, amber for copy, purple for backup/2fa, red for delete).
    - Event title (e.g., "Copied API key for OpenAI", "Unlocked vault", "Created login for GitHub").
    - Relative time (e.g., "2 minutes ago") with tooltip displaying full ISO 8601 timestamp.
    - Contextual metadata (IP address, user agent, entry type).
- Empty state: "No audit events recorded yet."

### 2. Clipboard 1-Action Copy & Auto-Clear (`CopyButton`)
- Rendered next to secret fields in `EntryDetail` (API Key, Password, Card Number, CVV, Note Body).
- States:
  - Default: Clipboard icon + "Copy" (or compact icon button with tooltip).
  - Copied: Green checkmark icon + "Copied! Clears in 30s".
  - Toast notification triggered with progress bar / countdown: "Secret copied to clipboard. Auto-clearing in 30 seconds."

### 3. Backup & Recovery (`BackupSettings` / `BackupModal`)
- Accessible from Settings / header menu.
- Two distinct sections:
  1. **Export Encrypted Backup**:
     - Descriptive text: "Export an encrypted snapshot of all vault entries, folders, tags, and audit history. This file is encrypted with Argon2id + AES-256-GCM."
     - Optional custom backup passphrase or toggle to use master password.
     - "Export Backup" button -> downloads `vault-backup-YYYY-MM-DD.vaultbackup`.
  2. **Restore Encrypted Backup**:
     - File dropzone / upload input accepting `.vaultbackup` or `.json`.
     - Passphrase input (password used during export).
     - Restore mode options: "Replace current vault" (clean restore) or "Merge entries".
     - Confirmation dialog with warning: "Restoring a backup will import all entries from the archive."
     - "Restore Vault" action button with loading spinner during KDF derivation & restore.
     - Toast notification on completion: "Vault successfully restored! [N] entries imported."
