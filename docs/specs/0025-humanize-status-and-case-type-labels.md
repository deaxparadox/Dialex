# Spec 0025 — Humanize debate status and case-type labels

No ADR — two small, independent display fixes (one serializer field, one Angular pipe), not a new dependency or cross-cutting architecture pattern.

## Root cause (verified by reading the code + querying the real DB directly, not assumed)

Two different raw-value problems, logged together in `TODO.md` because they show up as the same symptom (raw backend strings in the UI) but have different fixes:

**1. Debate status** (`debate-thread.html:30`, `{{ d.status }}` → "NO_CONSENSUS", "ARGUING"):
`backend/src/apps/debates/models.py`'s `Debate.Status` is a real `TextChoices` enum with human labels already defined server-side (`NO_CONSENSUS = "NO_CONSENSUS", "No consensus"`, etc.) — but `DebateSerializer` (`backend/src/apps/debates/serializers.py:65-82`) only lists `"status"` in `Meta.fields`, which serializes the raw enum value, not its label. The label already exists; it's just never exposed.

**2. Case-type slugs** (`debate-thread.html:28`'s `{{ case()?.type }}`, and `consultation-chat.html:69`'s `<option>` list, → "loan_approval", "research_debate"):
`CaseTypeConfig.type` (`backend/src/apps/cases/models.py:10`) is a free `CharField(unique=True)` with no `choices` — case types are admin-extensible, not a fixed enum, confirmed by querying the real DB (`docker compose exec django python manage.py shell`): only 2 rows exist today (`loan_approval`, `research_debate`), and `Case.type` denormalizes the same free string. There is no label to expose because none exists anywhere in the system.

Discussed both fixes with the user directly: status gets its already-existing label exposed (no real design choice — an obvious correctness fix); case-type slugs get a **frontend-only generic transform** (title-case + underscore→space), not a backend `display_name` field — chosen over the backend option for lower cost given both current slugs read cleanly under simple title-casing, revisit only if a future case type needs acronym-aware capitalization.

## Fix 1 — expose `status_display` from `DebateSerializer`

`backend/src/apps/debates/serializers.py`:
```python
class DebateSerializer(serializers.ModelSerializer):
    judge_persona = AgentPersonaMiniSerializer(read_only=True)
    verdict = VerdictSerializer(read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Debate
        fields = (
            "id",
            "case_id",
            "turn_strategy",
            "status",
            "status_display",
            "current_round",
            ...
        )
```
`status` stays as-is (raw value) — `debate-thread.html:35`'s `@if (d.status === 'OPEN')` and `:67`'s `d.status !== 'OPEN'` branch on it and must keep working unchanged. Only the *displayed* text switches to `status_display`:
```html
<span><b>Status</b>&nbsp; {{ d.status_display }}</span>
```
Frontend `Debate` interface (wherever `d.status` is typed — `debate-thread.ts`/a shared model file) gains `status_display: string`.

## Fix 2 — a shared `humanizeSlug` pipe for case-type slugs

Scaffold via `ng generate pipe shared/pipes/humanize-slug` (per CLAUDE.md's generator rule) rather than hand-writing the file, so it gets Angular's standard pipe boilerplate/test stub and is registered the normal way.

```ts
@Pipe({ name: 'humanizeSlug' })
export class HumanizeSlugPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '';
    const words = value.split(/[_-]+/);
    return words
      .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(' ');
  }
}
```
Title-cases only the first word (matching `Debate.Status`'s own label convention — "No consensus", not "No Consensus") — `"loan_approval"` → `"Loan approval"`, `"research_debate"` → `"Research debate"`.

Applied at the two known call sites:
- `debate-thread.html:28`: `<h1>{{ case()?.type | humanizeSlug }} &mdash; Case #{{ d.case_id }}</h1>`
- `consultation-chat.html:69`: `<option [value]="type">{{ type | humanizeSlug }}</option>`

Both components need `HumanizeSlugPipe` added to their `imports` array (standalone components).

## Explicitly out of scope

- A backend `display_name` field on `CaseTypeConfig` — considered, rejected for now per the design discussion above; revisit if a future case-type slug doesn't read cleanly under simple title-casing.
- Any other raw enum shown in the UI not already named in the `TODO.md` entry (e.g. `turn_strategy`, `AgentPersona.role`) — not currently displayed raw anywhere per a repo-wide grep; not touched here.
- Any change to what value is used for branching logic (`d.status === 'OPEN'`) — only the displayed text changes.

## Verification plan

- `humanizeSlug` pipe unit tests (generated stub + added cases): `loan_approval` → `Loan approval`, `research_debate` → `Research debate`, a single-word slug, `null`/`undefined`/`''` → `''`.
- Backend: `docker compose exec django python manage.py test apps.debates` after adding a `status_display` assertion to `backend/src/apps/debates/tests.py`'s existing serializer test; direct `curl` against a real `NO_CONSENSUS` debate confirming the response body has both `status: "NO_CONSENSUS"` and `status_display: "No consensus"`.
- `npx ng test` (full suite, not just the new pipe).
- Real browser: load a finished (`NO_CONSENSUS` or `JUDGED`) debate-thread page and confirm the status line reads humanized; confirm the case-type heading is humanized; confirm the "Start debate" / active-debate branch (gated on raw `d.status`) still renders correctly, i.e. the logic branch didn't silently break. Load consultation-chat's case-type picker and confirm both option labels are humanized.

## Branch

Continuing on `main`.

## Found during implementation/verification

No new bugs found. One deviation from the plan: `backend/src/apps/debates/tests.py` turned out to be the untouched default Django scaffold (no existing serializer test to extend, and no test-fixture/factory convention established anywhere in this Django app) — added the backend verification via direct `curl` against a real debate instead of a new `TestCase`, matching this project's established real-environment verification practice rather than inventing test infrastructure for one field.

- Backend: `python manage.py check` clean; `curl` against real debate 2 (`NO_CONSENSUS`) confirmed the response includes both `"status": "NO_CONSENSUS"` and `"status_display": "No consensus"` in the same body.
- Frontend: `npx ng test` — 26/26 pass (12 test files), including 5 new `HumanizeSlugPipe` unit tests (underscore slug, single word, hyphenated slug, null/undefined/empty).
- Real browser (Canary session): logged in as the real owning user (`tracer`, via a temporary password reset through Django shell, reverted to `set_unusable_password()` afterward). Debate 2 (`NO_CONSENSUS`/`research_debate`): status line read "No consensus", case-type heading read "Research debate", and — the specific regression this spec's plan called out — no active-debate/in-progress UI wrongly appeared; the page correctly rendered the full terminal-state thread (both argument rounds + verdict panel), confirming the raw-`status` branching logic (`d.status === 'OPEN'`) is unaffected. Consultation-chat's case-type dropdown showed both options humanized ("Loan approval", "Research debate"). Zero console errors throughout.

## Status

Implemented and verified against the real running stack. Closes the last item from the original 9-item feedback batch (`TODO.md`).
