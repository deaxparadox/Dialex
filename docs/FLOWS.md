# User-facing flows

> Status legend: ✅ done · ⚠️ partial/needs attention · 🚧 in progress · ❌ not started. Kept in sync with reality every commit that touches a flow — see this repo's CLAUDE.md.

| Flow | Status | Notes |
|---|---|---|
| Register / log in | ❌ | Designed (`docs/PRD.md` §7.8, `docs/API.md`), no implementation yet. |
| Submit a case via consultation | ❌ | Designed (`references/002-design-review-findings.md` decision 10), no implementation yet. |
| **View a live debate** | 🚧 | UI built and validated in a running app (`frontend/src/app/features/debate/debate-thread`) — driven by mock data only; not yet connected to a real backend, Temporal workflow, or the per-debate Redis stream (decision 12). |
| Review a judged debate (`HumanReview`) | ❌ | Designed (decision 8), no implementation yet. |
| Browse case/debate history | ❌ | Not designed as a screen yet beyond the PRD's screen inventory. |
| Notifications inbox | ❌ | Designed (decision 17), no implementation yet. |
