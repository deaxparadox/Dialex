# Spec 0039 — Next.js Phase 5: Human Review

Implements Phase 5 of ADR 0012/spec 0033, and Phase 3 of spec 0032 (ADR 0011 decision 1's Human Review design — already approved, never built in Angular; folds into this migration per ADR 0012 decision 4). The first migration phase needing a genuinely new backend endpoint, not just a port. Branch `migration/nextjs-frontend`.

## Root cause / current state, verified directly (not assumed)

- `apps/reviews/models.py`'s `HumanReview` already exists (built at scaffold time, spec 0002) — `OneToOneField` to `Debate` (DB-level duplicate-review prevention), `reviewer` (FK, `PROTECT`), `comment` (required), `final_decision` (nullable — null when `CaseTypeConfig.decision_options` is empty), `reviewed_at` (auto). No serializer, view, or URL exists yet — confirmed via `apps/reviews/` and `apps/debates/{serializers,views,urls}.py`, all read in full.
- `CaseTypeConfig.decision_options` (JSONField, e.g. `["approve", "deny"]` for `loan_approval`, `[]` for `research_debate`) already exists and is what drives the button-vs-comment-only rendering choice — no new config surface needed.
- `DebateSerializer` (`apps/debates/serializers.py`) has no `human_review` field — needs one, nested, null when unreviewed.
- `apps/debates/urls.py` has 3 routes today (list/detail/arguments) — needs a 4th.
- Design already fully decided in spec 0032 Phase 3 (not re-litigated here): `POST /api/debates/{id}/review/` — create, ownership-checked against `Debate.case.created_by`, 409 if a review already exists (the model's own `OneToOneField` already enforces this at the DB level; the view's job is surfacing a clean 409, not a raw 500 on the integrity error). Frontend: a panel appended under the verdict block, shown once `status` is `JUDGED` or `NO_CONSENSUS` — `decision_options` as buttons (empty list → comment-only) plus a required comment textarea; once `human_review` is present (own submission or reload), renders read-only (decision, comment, reviewer, timestamp) instead of the form.
- `frontend-next/src/app/(protected)/debates/[id]/page.tsx` (specs 0037/0038) is the one page this panel attaches to — no new route.

## Fix

### 1. Backend: `apps/reviews/serializers.py` (new)

```python
class HumanReviewSerializer(serializers.ModelSerializer):
    class Meta:
        model = HumanReview
        fields = ("id", "final_decision", "comment", "reviewer", "reviewed_at")
        read_only_fields = ("id", "reviewer", "reviewed_at")
```
`reviewer` exposed read-only (set server-side from `request.user`, never client-supplied).

### 2. Backend: `apps/reviews/views.py` (new)

A `CreateAPIView` (or equivalent) scoped by `debate_id` from the URL: 404 if the debate isn't found or isn't owned by the requesting user (same `case__created_by` pattern every other debate view already uses); on `perform_create`, set `debate_id`/`reviewer` server-side; catch the `IntegrityError` the model's `OneToOneField` raises on a duplicate and re-raise as DRF's `ValidationError`/a plain 409 response (matching spec 0032's own instruction — "the view just needs to surface it as a clean 409 not a 500").

### 3. Backend: wire it up

`apps/debates/urls.py` gains `path("<int:debate_id>/review/", HumanReviewCreateView.as_view(), name="debate-review")` (kept in the `debates` app's URL module since it's debate-scoped, matching the existing `arguments/` route's placement, even though the model lives in `apps.reviews` — a deliberate choice, not an oversight: the URL structure follows the resource being acted on). `DebateSerializer` gains `human_review = HumanReviewSerializer(read_only=True, allow_null=True)` (DRF's reverse `OneToOneField` accessor, `debate.human_review`, already exists on the model — no new query needed, just exposing it).

### 4. Frontend: data layer

`useDebatesApi()` gains `submitReview(debateId, { finalDecision, comment })` (Django POST, through `useApiFetch()`, which now needs `credentials: 'include'` passed explicitly for this one call — the first real Django POST through this hook, needing the CSRF-cookie round-trip spec 0036 deliberately stopped defaulting to). `ApiDebate` gains `human_review: ApiHumanReview | null`. Need `CaseTypeConfig.decision_options` — add `getCaseTypeConfig(type)` (or extend the existing case-types list call) to `useConsultationsApi`/a shared config fetch, whichever is the smaller diff once actually wiring it (decided at implementation time).

### 5. Frontend: the panel

Appended under the verdict block in `(protected)/debates/[id]/page.tsx`, shown when `debate.status` is `JUDGED` or `NO_CONSENSUS`: `decision_options.length > 0` renders decision buttons + a required comment textarea + submit; `decision_options.length === 0` renders comment-only + submit. Once `debate.human_review` is non-null (either from the initial load or right after a successful submit), renders read-only instead: decision (if any), comment, reviewer, `reviewed_at`.

## Explicitly out of scope

Notifications — Phase 6. Any change to `DebateSerializer`'s existing fields beyond adding `human_review` (matching spec 0032's own scope line). Pagination anywhere.

## Verification plan

Real browser + direct API checks: a real `research_debate` (empty `decision_options`) and a real `loan_approval` (non-empty) both confirm the comment-only vs. buttons rendering; submitting a review persists it and the panel flips to read-only without a reload; a second submit attempt (reload then resubmit, or a direct duplicate API call) returns a clean 409, not a 500 or silent failure; an IDOR check confirms a debate not owned by the requester 404s on both the new endpoint and the enriched detail response; `frontend/` (Angular) confirmed unaffected, its tests still pass (this phase's backend change is additive-only — a new field, a new endpoint — so the existing Angular `ApiDebate` type simply ignores the new field it doesn't declare).

## Found during implementation

`GET /api/case-type-configs/` (`apps/cases/serializers.py`) only ever returned `type` — confirmed the panel genuinely needs `decision_options` client-side to decide buttons-vs-comment-only, so added it to `CaseTypeConfigSerializer`'s `fields` (one line). Purely additive; `frontend/`'s existing `ApiCaseType` interface (`{type: string}`) simply ignores the new field, no break.

## Found during verification

Direct API checks (curl) confirmed the backend in isolation before touching the frontend: a real submit returned `201` with the persisted row; an immediate duplicate submit returned a clean `409` with a plain message, not a 500; a cross-user IDOR attempt (submitting against another user's debate) returned `404`, matching every other debate endpoint's ownership pattern.

Real Canary browser session, two debates: an already-reviewed `loan_approval` debate (decision `approve`, a comment, a timestamp) rendered fully read-only — zero `<textarea>`/`<button>` elements in the panel, confirming no leftover form; a fresh, unreviewed `research_debate` (empty `decision_options`) rendered comment-only (no decision buttons), correctly disabled submit with an empty comment, submitted successfully once filled, flipped to read-only immediately without a reload, and — reloaded — showed the identical read-only state, confirming the review is genuinely server-persisted, not just client-side optimism. A whole-page scan after submission confirmed no second submission form exists anywhere. Zero console errors throughout. `frontend/` (Angular) confirmed unaffected — this phase's backend changes are additive-only (a new field, a new endpoint), Angular's existing types simply don't declare them.

## Status

Implemented and verified against the real running stack, backend and frontend both. Closes Phase 5 of ADR 0012/spec 0033 (and Phase 3 of spec 0032/ADR 0011). Phase 6 (Notifications) is next, its own spec to be written before it starts — the read-path scope only, per spec 0032 Phase 4a (live push stays Phase 4b there, out of scope unless separately requested).

## Branch

`migration/nextjs-frontend` (continuing).
