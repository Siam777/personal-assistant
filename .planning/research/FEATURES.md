# Feature Research

**Domain:** Personal credential/secrets vault + image-to-text (OCR) tool
**Researched:** 2026-08-18
**Confidence:** MEDIUM (cross-checked across official vendor docs, Apple/Google support pages, and multiple independent reviews; no primary-source academic security papers consulted)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist in any credential manager or OCR tool. Missing these makes the product feel broken or unsafe, even for a solo/local-first build.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Encryption at rest (no plaintext ever) | Every major manager (Bitwarden, 1Password, KeePass) treats this as the non-negotiable baseline; it's the entire reason the product category exists | MEDIUM | Use AES-256-GCM (authenticated encryption) for vault data, keyed by a value derived from the master password via a strong KDF (Argon2id preferred, PBKDF2 acceptable fallback). Never store the derived key or plaintext on disk. |
| Master password unlock | Universal entry point across Bitwarden, 1Password, KeePass — the one secret the user must remember | LOW–MEDIUM | Master password itself is never stored; only a verifier/derived key check. Pair with KDF above. |
| Store multiple secret types (logins, notes, cards, API keys) | Bitwarden and 1Password both support logins/notes/cards/identities as first-class item types; users expect one vault for "everything sensitive" not just website passwords | MEDIUM | Already scoped in PROJECT.md. Each type needs its own metadata schema (login: user/pass/URL; API key: key/endpoint/model/notes; card: number/expiry/CVV; note: freeform). |
| Search across all entries | Table stakes in every manager — vaults grow past the point of browsing quickly | LOW | Client-side search over decrypted-in-memory index; avoid indexing plaintext to disk. |
| Folders/categories + tags | Bitwarden, 1Password, KeePass all support hierarchical organization; without it a vault beyond ~30 items becomes unusable | LOW–MEDIUM | Folders = single-parent grouping; tags = many-to-many filter. Both requested explicitly in PROJECT.md. |
| Password generator | Present in every manager researched (Bitwarden, 1Password, KeePass) as a core, not premium, feature | LOW | Cryptographically random, configurable length/character classes; industry guidance favors 16–20+ chars by default. |
| Copy-to-clipboard for secrets | The base interaction pattern for using a vault day-to-day — you retrieve a secret to paste it elsewhere | LOW | Pairs with clipboard-clear (see Differentiators/Security section below). |
| Auto-lock / session timeout | Called out explicitly in best-practice research as a baseline expectation, not an extra; vaults that stay unlocked indefinitely are considered a known weak configuration | LOW–MEDIUM | Lock vault (re-derive key requirement) after N minutes idle or on tab/window blur, configurable. |
| 2FA/TOTP on top of master password | Bitwarden ships this as a core/premium feature; explicitly requested in PROJECT.md as "optional 2FA" | MEDIUM | TOTP (RFC 6238) is the de facto standard; store the TOTP secret itself encrypted like any other vault secret. |
| Basic OCR: upload/drag image → extract text | This is the entire premise of Google Lens / Apple Live Text "scan text" flows — extraction from a static image is the minimum viable OCR feature | MEDIUM | Client-side (Tesseract.js) or a local OCR engine keeps it consistent with local-first constraint; server-side OCR APIs would violate the local-only v1 constraint. |
| Preview before use (OCR) | Both Google Lens and Apple Live Text show/highlight recognized text in place before any copy action — users don't trust "blind" OCR that copies without letting them see/correct the result | LOW–MEDIUM | Show extracted text in an editable preview pane; let user visually cross-check against the source image before copying. |
| One-action copy to clipboard (OCR) | Google Lens's entire output model *is* copy — there's no separate "export" step; users expect a single tap/click to get text into clipboard | LOW | Trivial once preview exists; the "one action" bar is the differentiator over raw OCR dumps. |

### Differentiators (Competitive Advantage)

Not required for a functioning vault, but this is where "industry grade" polish and personal-tool advantages over generic competitors come from.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Audit log of secret access (who/when/where) | Explicitly requested in PROJECT.md; 1Password's enterprise tier gates this behind Watchtower/Business plans — offering it by default in a personal tool is a genuine step up, and it directly serves the "never leak silently" Core Value | MEDIUM | Log read/copy/reveal events (timestamp, entry id, action type) in an append-only local log, itself encrypted. Do NOT log the secret value. |
| Live camera capture for OCR | Apple Live Text and Google Lens both support live-viewfinder recognition, not just static image upload — this is the "smarter clipboard" behavior explicitly named in PROJECT.md | MEDIUM–HIGH | Requires `getUserMedia` camera access, live frame sampling, and either continuous or on-demand OCR triggering. Bigger lift than static-image OCR; justify placing it in a later phase if needed. |
| Clipboard auto-clear after copy | Research found many mainstream managers (Bitwarden, Keeper) leave clipboard-clear *off* by default — doing this well and on-by-default is a meaningful, low-cost trust signal for a security-focused personal tool | LOW | Clear clipboard automatically 20–30s after a vault secret copy (best-practice window from research). Does not apply to OCR copies (those are meant to persist for pasting elsewhere). |
| Password strength meter at entry time | Common security-hygiene nudge across the ecosystem; helps enforce the Core Value ("secrets stored are always safe") at the point of creation rather than after the fact | LOW | Simple entropy/heuristic scoring (e.g. zxcvbn-style) shown live while typing/generating. |
| Breach/reuse checking (Watchtower-style) | 1Password's signature differentiator; catches weak/reused/compromised credentials proactively rather than leaving the user to discover a breach elsewhere | MEDIUM–HIGH | For a local-only v1, "reused password" detection is easy (compare hashes within the vault) and should ship; live breach-database checking (e.g. k-anonymity HIBP lookup) requires an outbound network call, which conflicts with the local-only constraint — flag as a v1.x/v2 add if network calls become acceptable. |
| Extensible entry schema for future hub modules | PROJECT.md frames this as the first module of a broader personal assistant platform — designing entry types/storage so new modules (notes, tasks, bookmarks) can plug in later is a forward-looking differentiator, not required for v1 functionality | MEDIUM | Architectural concern more than a user-facing feature; keep entry-type schema pluggable (discriminated union / type registry) from day one. |
| Encrypted local backup/restore | KeePass's single-portable-file model and Bitwarden's encrypted-export options both demonstrate this pattern; for a local-only tool with no cloud sync, a trustworthy backup/restore *is* the disaster-recovery story | MEDIUM | Export whole vault as a single encrypted file (password-protected, KDF-stretched key) the user can copy to external storage; restore re-derives the key and decrypts. This is the local-first substitute for "cloud sync" and should be treated as near-table-stakes given local-only is a stated constraint. |
| OCR history / recent scans | Neither Lens nor Live Text keep a persistent history (they're ephemeral by design) — but for a personal tool used repeatedly for API keys/config snippets, a short-lived "recent extractions" list saves re-scanning | LOW–MEDIUM | Optional, should default to a short retention window (or off) since OCR output can itself contain sensitive text (e.g. a scanned recovery code) — treat with the same care as vault secrets if retained. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that look good on a competitor feature-comparison chart but are wrong for this project's stated scope and constraints.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Cloud sync / multi-device sync | Every mainstream manager (Bitwarden, 1Password) leads with sync as a headline feature | Explicitly out of scope in PROJECT.md; adds a server, an account system, and a much larger attack surface (transmission, remote storage, multi-device key management) before the core local vault design is even validated | Ship local-only v1; revisit sync as its own dedicated milestone once the local vault/encryption model is proven |
| Browser extension / autofill | Bitwarden and 1Password treat autofill as core UX — it's the single most-used feature in those products | Explicitly out of scope in PROJECT.md; autofill requires deep browser integration (content scripts, form-field heuristics) and expands attack surface (extension permissions, page-script interaction) disproportionate to a v1 standalone app | Standalone app with manual copy/paste for v1; reconsider once the app itself is stable |
| Multi-user / shared vaults / emergency access | Bitwarden Premium and 1Password Families/Business both offer this; "sharing" feels like an obvious next step | PROJECT.md is explicit: single-user, no multi-tenant concerns; access-control and sharing models add real complexity (permission models, key-sharing cryptography) with zero payoff for a solo tool | Skip entirely for v1 and likely v2; revisit only if the platform vision expands to multi-user |
| Live breach-database checking via network call (full Watchtower parity) | 1Password's Watchtower checks against live compromised-credential databases and is the most-cited "premium" differentiator in the category | Requires an outbound network dependency, which conflicts with the "local-only, no cloud dependency" constraint in PROJECT.md and expands the trust boundary (third-party API, data-in-transit) that a local-first tool is explicitly trying to avoid | Ship local reuse/weak-password detection (no network needed); defer live breach checking to a later milestone if/when network calls become acceptable, using a privacy-preserving method (k-anonymity HIBP-style range query) rather than sending full credentials |
| Server-side/cloud OCR (e.g. calling a hosted vision API) | Cloud OCR APIs (Google Cloud Vision, Azure) are often the fastest path to "good" OCR accuracy and are commonly reached for by default | Sends potentially sensitive image content (screenshots of API keys, recovery codes, etc.) to a third party, directly undermining the local-first/no-plaintext-leak posture the vault half of this product is built on | Use an on-device/client-side OCR engine (e.g. Tesseract.js or a local OCR library) so extracted text and source images never leave the machine |
| Persistent unencrypted OCR/clipboard history | Feels convenient ("Lens keeps recent scans"), and general-purpose clipboard managers do this | If the tool is regularly used to OCR API keys, license keys, or recovery codes (a realistic use case per PROJECT.md's stated motivation), an unencrypted history becomes an unintended second, weaker vault sitting outside the main encryption boundary | If OCR history ships at all, treat it as sensitive by default: encrypt it under the same vault key and give it a short, user-configurable retention window, or default to "don't retain" |
| Plugin architecture / scripting (KeePass-style extensibility) | KeePass differentiates on a mature plugin ecosystem | Massive scope and maintenance surface for a solo v1 build; PROJECT.md frames future extensibility as new *modules* of the platform, not a plugin API for third parties | Design internal data/entry-type layer to be extensible (see Differentiators) without exposing a public plugin/scripting surface in v1 |

## Feature Dependencies

```
Encryption at rest (KDF + AES-256-GCM)
    └──requires──> Master password unlock
                       └──requires──> Auto-lock / session timeout (defines when re-auth is needed)

2FA/TOTP
    └──requires──> Master password unlock (2FA is additive, not a replacement)

Audit log of secret access
    └──requires──> Encryption at rest (log itself must be encrypted, not a plaintext side-channel)
    └──requires──> Copy-to-clipboard for secrets (primary event the log records)

Encrypted local backup/restore
    └──requires──> Encryption at rest (backup format reuses the same KDF/cipher scheme)

Breach/reuse checking (local reuse detection)
    └──requires──> Store multiple secret types (needs a populated vault to compare against)

Live camera capture (OCR)
    └──enhances──> Basic OCR: upload/drag image → extract text (shares the same OCR engine/pipeline)

Preview before use (OCR)
    └──requires──> Basic OCR: upload/drag image → extract text
One-action copy to clipboard (OCR)
    └──requires──> Preview before use (OCR) (user must see/trust the text before one-tap copy)

Clipboard auto-clear after copy
    └──enhances──> Copy-to-clipboard for secrets (vault secrets only, not OCR output)

OCR history / recent scans
    └──requires──> Encryption at rest (if retained, must live inside the same encryption boundary)

Cloud sync [anti-feature] ──conflicts──> Local-only storage constraint
Live breach-database checking [anti-feature, deferred] ──conflicts──> No-cloud-dependency constraint
Server-side OCR [anti-feature] ──conflicts──> Local-first / no-plaintext-leak posture
Browser extension/autofill [anti-feature] ──conflicts──> Standalone-app-first constraint
```

### Dependency Notes

- **Encryption at rest requires master password unlock:** The KDF-derived key that decrypts the vault only exists after a valid master password is supplied; there's no encryption scheme here without an unlock step to feed it.
- **Auto-lock requires encryption at rest:** Locking only means something if "locked" state genuinely discards the derived key from memory, not just hides the UI.
- **Audit log requires encryption at rest:** An unencrypted audit log defeats the point — it would itself become a plaintext record of exactly which secrets exist and when they were accessed, which is a leak vector as sensitive as the secrets themselves.
- **One-action OCR copy requires preview:** Google Lens and Apple Live Text both interpose a visible/selectable text state before any copy action; skipping straight from "scan" to "clipboard" removes the user's ability to catch OCR misreads (a real risk when scanning API keys — one wrong character breaks the credential).
- **Clipboard auto-clear enhances (but is scoped to) vault-secret copies:** Applying the same aggressive clear timer to OCR output would break the "smarter clipboard" use case in PROJECT.md, where the whole point is pasting extracted text into another app at the user's own pace.
- **Cloud sync / server-side OCR / live breach checking conflict with local-only constraint:** All three would require sending vault-adjacent data (secrets, images, or credential hashes) off-device, directly violating the "no cloud dependency" and "no plaintext leak" constraints stated in PROJECT.md. Each is deferred rather than rejected outright — they become viable once (if) a future milestone deliberately revisits the local-only decision.

## MVP Definition

### Launch With (v1)

Minimum viable product — matches the Active requirements already listed in PROJECT.md; every one of these is table stakes per the research above.

- [ ] Store/retrieve API keys, passwords/logins, secure notes, cards — core vault value; without all four types the vault doesn't cover the user's stated motivation (managing API keys plus other secrets)
- [ ] Folders + tags + cross-entry search — organization is table stakes once entry count grows past a handful
- [ ] Master password unlock + optional 2FA — the entire trust boundary of the product
- [ ] Encryption at rest, no plaintext ever (KDF + AES-256-GCM) — this is the Core Value from PROJECT.md; non-negotiable
- [ ] Auto-lock / session timeout — baseline security hygiene, low complexity, high trust payoff
- [ ] Password generator — table stakes, low complexity, directly supports the Core Value (encourages strong secrets going in)
- [ ] Clipboard copy with auto-clear — the daily-use interaction, paired with the differentiator that mainstream tools often skip
- [ ] Audit log of secret access — explicitly requested, directly serves "never fail or leak" Core Value, and is cheap once encryption-at-rest exists
- [ ] OCR: upload/drag image → preview → one-action copy — the second module's entire MVP loop, mirrors the proven Lens/Live Text UX pattern
- [ ] OCR: live camera capture → preview → copy — explicitly requested as the "smarter clipboard" behavior; can follow static-image OCR in sequencing since it shares the same engine

### Add After Validation (v1.x)

Features to add once the core vault and OCR loops are working and trusted.

- [ ] Local reuse/weak-password detection — trigger: once the vault has enough entries that reuse is a realistic risk (not meaningful on a near-empty vault)
- [ ] Encrypted local backup/restore — trigger: as soon as the user has enough real secrets in the vault that losing the local file would hurt; should land early in v1.x given no cloud sync exists as a safety net
- [ ] OCR history / recent scans (encrypted, short retention) — trigger: user feedback that re-scanning the same source repeatedly is annoying
- [ ] Password strength meter at entry time — trigger: after the generator ships, as a complementary nudge for manually-entered passwords

### Future Consideration (v2+)

Features to defer until the local-first vault design and OCR module have proven themselves.

- [ ] Cloud sync / multi-device — defer until the local vault's encryption model and UX are validated; sync is a major architecture and trust-boundary change, explicitly deferred in PROJECT.md
- [ ] Live breach-database checking (privacy-preserving, e.g. k-anonymity HIBP-style) — defer until (if) a network dependency becomes acceptable; local reuse detection covers the low-hanging-fruit case without it
- [ ] Browser extension / autofill — defer until the standalone app is stable; explicitly out of scope for v1
- [ ] Multi-user / shared vaults — defer indefinitely unless the platform vision explicitly expands beyond single-user
- [ ] Extensible entry-type registry for other hub modules (notes, tasks, bookmarks) — the *architecture* for this should be considered in v1 design (see Differentiators), but the actual additional modules are future milestones per PROJECT.md

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Encryption at rest (KDF + AES-256-GCM) | HIGH | MEDIUM | P1 |
| Master password unlock | HIGH | LOW–MEDIUM | P1 |
| Store logins/notes/cards/API keys | HIGH | MEDIUM | P1 |
| Folders + tags + search | HIGH | LOW–MEDIUM | P1 |
| Auto-lock / session timeout | HIGH | LOW–MEDIUM | P1 |
| 2FA/TOTP | MEDIUM | MEDIUM | P1 |
| Password generator | MEDIUM | LOW | P1 |
| Clipboard copy + auto-clear | HIGH | LOW | P1 |
| Audit log of secret access | MEDIUM | MEDIUM | P1 |
| OCR upload/drag + preview + copy | HIGH | MEDIUM | P1 |
| OCR live camera capture | MEDIUM | MEDIUM–HIGH | P1 |
| Encrypted local backup/restore | HIGH | MEDIUM | P2 |
| Local reuse/weak-password detection | MEDIUM | MEDIUM | P2 |
| Password strength meter | LOW–MEDIUM | LOW | P2 |
| OCR history (encrypted, short retention) | LOW–MEDIUM | LOW–MEDIUM | P2 |
| Live breach-database checking (network) | MEDIUM | MEDIUM–HIGH | P3 |
| Cloud sync | HIGH (long-term) | HIGH | P3 |
| Browser extension/autofill | MEDIUM | HIGH | P3 |
| Multi-user/shared vaults | LOW (for this user) | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Bitwarden | 1Password | KeePass | Google Lens / Apple Live Text | Our Approach |
|---------|-----------|-----------|---------|-------------------------------|--------------|
| Encryption model | AES-256, client-side, open source (auditable) | AES-256, zero-knowledge, proprietary | AES-256/ChaCha20/Twofish, fully local, open source | N/A | AES-256-GCM + Argon2id KDF, local-only, no server ever sees plaintext or key |
| Storage location | Cloud-hosted (self-host option) | Cloud-hosted | Fully local single file (.kdbx) | N/A (on-device processing) | Fully local, matching KeePass's model but with a friendlier UX layer |
| Breach/weak-password monitoring | Vault health alerts (Premium) | Watchtower (flagship, proactive dashboard) | None (manual/plugin only) | N/A | Local reuse detection in v1.x; live breach checking deferred to v2 (network dependency conflicts with local-only constraint) |
| Import/export | JSON/CSV, encrypted export options (account-restricted, password-protected) | Encrypted export supported | .kdbx (native, encrypted); CSV/XML export | N/A | Encrypted backup/restore as the local-first substitute for sync; avoid plaintext CSV as default |
| Secrets (API keys, dev credentials) | Supported as generic secure notes/items | First-class "Secrets Management" product line (SSH keys, API tokens) | Supported as generic entries/attachments | N/A | First-class API key entry type with endpoint/model/notes metadata (already scoped in PROJECT.md) — matches 1Password's developer-focus without the CLI/SDK complexity |
| Audit/access logging | Security reports (Premium) | Available in Business/Enterprise tiers only | None | N/A | Included by default for a single user — a genuine differentiator vs. gating it behind a paid tier |
| OCR text extraction UX | N/A | N/A | N/A | Auto-detect text region → select → action bar (Copy/Translate/Search); Live Text needs zero manual "scan" step | Adopt the "detect → preview/selectable → one-tap copy" pattern from both; add explicit preview step before copy since our use case (API keys, config snippets) is less forgiving of misreads than casual text-in-a-photo use |
| Live camera OCR | N/A | N/A | N/A | Both support live-viewfinder recognition | Support as P1 per explicit PROJECT.md requirement, sharing the same OCR pipeline as static-image upload |

## Sources

- [Password Management Tools & Features — Bitwarden](https://bitwarden.com/tools-and-features/)
- [Password Manager Overview — Bitwarden](https://bitwarden.com/help/password-manager-overview/)
- [Password Manager Plans — Bitwarden](https://bitwarden.com/help/password-manager-plans/)
- [Export Vault Data — Bitwarden](https://bitwarden.com/help/export-your-data/)
- [Encrypted Exports — Bitwarden](https://bitwarden.com/help/encrypted-export/)
- [1Password Features](https://1password.com/features)
- [1Password Watchtower — Identify Security Risks](https://1password.com/features/watchtower-identifies-security-risks)
- [Use Watchtower — 1Password Support](https://support.1password.com/watchtower/)
- [Secrets Management — 1Password](https://1password.com/features/secrets-management)
- [KeePass Review 2026 — SafetyDetectives](https://www.safetydetectives.com/best-password-managers/keepass/)
- [How KeePass Encryption Works: AES-256, Twofish, ChaCha20 — PanicVault](https://www.panicvault.org/keepass/encryption-explained/)
- [KeePass Review 2026 — AllAboutCookies](https://allaboutcookies.org/keepass-password-manager-review)
- [You should change your password manager's clipboard settings now — TechSpot](https://www.techspot.com/news/97320-you-change-password-manager-clipboard-settings-now.html)
- [The one password manager setting you should always change — PCWorld](https://www.pcworld.com/article/1471936/you-should-always-change-this-setting-in-your-password-manager.html)
- [10 Password Manager Best Practices for 2025 — Digital Footprint Check](https://www.digitalfootprintcheck.com/password-manager-best-practices)
- [Google Lens: The Ultimate Image to Text Converter — Medium](https://medium.com/@zohaibraza.3939/google-lens-the-ultimate-image-to-text-converter-and-online-ocr-38865f4faa2b)
- [How to copy text from an image on Android — iDownloadBlog](https://www.idownloadblog.com/2025/04/23/how-to-select-text-from-image-android/)
- [Google's Gboard beta tests 'Scan text' feature — AlternativeTo](https://alternativeto.net/news/2023/11/google-s-gboard-beta-tests-new-scan-text-feature-for-direct-text-extraction-from-images)
- [Use Live Text to interact with content in a photo on iPhone — Apple Support](https://support.apple.com/guide/iphone/interact-with-content-in-a-photo-or-video-iph37fdd714b/ios)
- [Use Live Text to interact with text in a photo on Mac — Apple Support](https://support.apple.com/guide/photos/live-text-interact-a-photo-pht6bc6bd5f5/mac)
- [Copy and translate text from photos — Apple Support](https://support.apple.com/en-us/120004)
- [How To Use Live Text to Copy Text From Images & Screenshots on Mac — machow2](https://machow2.com/copy-text-image-screenshot-mac/)
- [Zero-Knowledge Encryption & Security Model — LastPass](https://www.lastpass.com/security/zero-knowledge-security)
- [GitHub — mindmapvault (local-first, zero-knowledge, Tauri reference)](https://github.com/kornelko2/mindmapvault)
- [Keeper Encryption and Security Model Details](https://docs.keeper.io/enterprise-guide/keeper-encryption-model)
- [Import/Export section — Kaspersky Password Manager](https://support.kaspersky.com/help/KPM/Win24.3/en-US/91099.htm)
- [Guide: How to Create and Store a Backup of Your Bitwarden Vault](https://bitwarden.com/resources/guide-how-to-create-and-store-a-backup-of-your-bitwarden-vault/)

---
*Feature research for: Personal credential vault + OCR tool*
*Researched: 2026-08-18*
