---
schema_version: 1
open_count: 0
waived_count: 0
fixed_count: 2
total_count: 2
last_updated: 2026-08-19T22:23:22.983Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | stub | client/src/App.tsx | 63 | Unlocked view renders a plan-sanctioned placeholder panel text instead of the real unlocked screen; Plan 01-03 replaces it with the real unlock/locked-state screens | fixed |  | 2026-08-18T05:56:35.763Z | 2026-08-18T15:39:47.459Z |
| 2 | 01 | stub | client/src/App.tsx |  | Unlocked branch renders a placeholder panel instead of the real vault entry view; Phase 2 delivers the real view (scope boundary, not a gap) | fixed |  | 2026-08-18T09:49:01.662Z | 2026-08-19T22:23:22.983Z |

````json
[
  {
    "id": 1,
    "kind": "stub",
    "phase": "01",
    "file": "client/src/App.tsx",
    "line": 63,
    "description": "Unlocked view renders a plan-sanctioned placeholder panel text instead of the real unlocked screen; Plan 01-03 replaces it with the real unlock/locked-state screens",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-18T05:56:35.763Z",
    "resolved_at": "2026-08-18T15:39:47.459Z"
  },
  {
    "id": 2,
    "kind": "stub",
    "phase": "01",
    "file": "client/src/App.tsx",
    "line": null,
    "description": "Unlocked branch renders a placeholder panel instead of the real vault entry view; Phase 2 delivers the real view (scope boundary, not a gap)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-18T09:49:01.662Z",
    "resolved_at": "2026-08-19T22:23:22.983Z"
  }
]
````


