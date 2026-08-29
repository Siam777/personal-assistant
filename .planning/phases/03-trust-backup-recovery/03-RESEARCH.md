# Phase 3: Trust, Backup & Recovery - Research & Architecture

## Security and Cryptographic Standards

### 1. Audit Logging Security
- **Strict Data Scrubbing**: Audit logs must record operational metadata (`eventType`, `entryId`, `entryName`, `entryType`, `fieldName`, `timestamp`, `ipAddress`, `userAgent`) but **NEVER** plaintext secret payloads or secret fields.
- **Append-only Ingestion**: The database table `audit_logs` is write-heavy with reads occurring in the Audit Viewer UI. An index on `created_at DESC` and `entry_id` ensures efficient pagination.

### 2. Clipboard Management and Auto-Clear
- **Clipboard API**: Use standard `navigator.clipboard.writeText(...)`.
- **Auto-Clear Timer**: On copying any secret value (password, API key, card details, note text), a timer (default 30 seconds) is scheduled.
- When the timer fires, client clears clipboard if still in focus / active (`navigator.clipboard.writeText('')`), or provides feedback.
- Clean destruction on component unmount and session lock.

### 3. Encrypted Backup Container Format
- Uses authenticated encryption: AES-256-GCM.
- Key derivation: Argon2id (using standard calibrated parameters from config / sidecar).
- Backup Container JSON shape:
```json
{
  "version": 1,
  "format": "personal-assistant-encrypted-backup",
  "exported_at": "2026-08-29T12:00:00.000Z",
  "kdf": {
    "type": "argon2id",
    "memoryCost": 65536,
    "timeCost": 3,
    "parallelism": 4,
    "hashLength": 32,
    "saltB64": "..."
  },
  "crypto": {
    "algorithm": "AES-256-GCM",
    "ivB64": "...",
    "authTagB64": "...",
    "ciphertextB64": "..."
  }
}
```
- **Integrity Guarantee**: Decryption verifies the GCM 16-byte authentication tag first. If any single byte of ciphertext or header is modified, decryption throws immediately with an authentication error, guaranteeing corrupt data is rejected prior to touching SQLite.
- **Transactional Restoration**: Restoring uses Kysely's `db.transaction().execute(async (trx) => { ... })` to ensure atomic state updates.
