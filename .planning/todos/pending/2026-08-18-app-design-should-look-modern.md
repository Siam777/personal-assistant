---
created: 2026-08-18T16:06:46.851Z
title: App design should look modern
area: ui
severity: cosmetic
files:
  - client/src/App.tsx
  - client/src/features/vault-unlock/InitScreen.tsx
  - client/src/features/vault-unlock/UnlockScreen.tsx
  - client/src/features/vault-2fa/EnrollScreen.tsx
---

## Problem

The client currently has zero styling — no CSS files, no UI/component library, bare unstyled HTML (`client/package.json` has no styling dependency at all). This was intentional for Phase 1, which was scoped purely as the crypto/session security foundation (mode: mvp, no UI polish). The user explicitly asked for a modern-looking design going forward.

## Solution

Feed this into `/gsd-ui-phase` when planning Phase 2 (Vault Core — Entries, Organization & Search), which ROADMAP.md already flags as `UI hint: yes`. That step establishes the design system/visual direction before Phase 2 plans are written. Also consider whether Phase 1's existing screens (InitScreen, UnlockScreen, NoRecoveryWarning, LockedNotice, the vault-2fa screens) should get a retroactive style pass once the design system exists, or whether they're acceptable as-is since they're rarely-seen one-time flows.
