# User-facing flows

> Status legend: ✅ done · ⚠️ partial/needs attention · 🚧 in progress · ❌ not started. Kept in sync with reality every commit that touches a flow — see this repo's CLAUDE.md.

| Flow | Status | Notes |
|---|---|---|
| Register / log in | ⚠️ | Backend done and verified: `POST /api/auth/{register,login,refresh,logout}/` implemented per decisions 13/13a (cookie-based refresh, CSRF-protected, rotation+blacklist) — 7 automated tests + manual end-to-end verification, both passing. No frontend UI yet (`frontend/`'s Angular HTTP interceptor / login screen from ADR 0001 not built) — a user can't actually log in through the app yet, only via direct API calls. |
| Submit a case via consultation | ❌ | Designed (`references/002-design-review-findings.md` decision 10), no implementation yet. |
| **View a live debate** | 🚧 | UI built and validated in a running app (`frontend/src/app/features/debate/debate-thread`) — driven by mock data only; not yet connected to a real backend, Temporal workflow, or the per-debate Redis stream (decision 12). |
| Review a judged debate (`HumanReview`) | ❌ | Designed (decision 8), no implementation yet. |
| Browse case/debate history | ❌ | Not designed as a screen yet beyond the PRD's screen inventory. |
| Notifications inbox | ❌ | Designed (decision 17), no implementation yet. |
