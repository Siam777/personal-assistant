/**
 * Signature-only stub. `requireUnlocked.ts` needs these two functions to
 * type-check against; Plan 01-02 replaces both bodies with the real
 * module-scoped session singleton (Vault Key holder, open DB handle,
 * server-authoritative idle timer) described in `01-SKELETON.md`'s
 * "Contracts Later Phases Depend On" table.
 */

const NOT_IMPLEMENTED = "session module not implemented until Plan 01-02";

export function isUnlocked(): boolean {
  throw new Error(NOT_IMPLEMENTED);
}

export function armIdleTimer(): void {
  throw new Error(NOT_IMPLEMENTED);
}
