# Spec 0030 — Case-type required-fields schema + consultant-side enforcement

Implements ADR 0010, sequencing part 1 of 2 (data model + consultant intake). Part 2 (debate-side `policy_context` injection + persona content) follows as its own spec once this is verified.

## Root cause / current state, verified directly (not assumed)

- `CaseTypeConfig` (`backend/src/apps/cases/models.py`) has no field defining what a case-type's intake must actually collect — `research_guardrail_prompt` exists but is empty for both configured case types and unused by any code path.
- The consultant's structured-output schema (`orchestrator/app/consultations/schemas.py`'s `ConsultantTurnOutput`) has `proposed_payload_json: str | None` — a free-form JSON-encoded string, deliberately not a nested object, because (per the existing code comment, verified) OpenAI's strict structured-output mode rejects any object without every property enumerated. This is still correct for a genuinely open-ended case type (`research_debate`) — but for `loan_approval`, it means the consultant can set `ready_to_finalize=true` with any payload shape at all, including one missing fields obviously needed for a real lending decision.
- Verified via context7 against current LangChain docs: nested Pydantic models with fully enumerated fields work fine with `with_structured_output()` — the free-form-dict failure mode this codebase hit before doesn't apply once every field is named up front, which `required_fields` provides.
- Verified via context7 against current Pydantic (2.13.4, installed) docs: `pydantic.create_model()` supports building a model from field name → `(type, Field(...))` tuples at runtime, and supports `__base__` to extend a statically-declared model — enough to build a per-case-type schema without hand-writing one class per case type.
- `fetch_consultation_context` (`orchestrator/app/consultations/activities.py`) currently fetches only `session` + `consultant_persona` — it never touches `CaseTypeConfig` at all. Only the very last step (`create_case_and_debate`, at approval time) reads it, via `queries.get_case_type_defaults`.

## Fix

### 1. `CaseTypeConfig` migration (Django, scaffolded via `manage.py makemigrations`, not hand-written)

- New field: `required_fields = models.JSONField(default=list, blank=True, help_text="List of {name, type, description} the consultant must collect before finalizing. Empty list (e.g. research_debate) keeps the intake fully free-form, unchanged from today.")`
- Rename `research_guardrail_prompt` → `policy_context` (a real `RenameField`, not add-new-drop-old — both existing rows are empty strings today, but the rename is still the correct operation). **Not consumed by any code path in this spec** — that's spec 2's job; this spec only moves the schema into place.
- Regenerate `orchestrator/app/core/generated_tables.py` per its own header comment (`sqlacodegen --generator tables "$DATABASE_URL" > app/core/generated_tables.py`), matching this project's established pattern (decision 9) — never hand-edited.

### 2. Consultant-side plumbing to reach the graph

`fetch_consultation_context` (activity) also calls `queries.get_case_type_defaults(session["case_type"])` (already exists, already used elsewhere — reused here rather than adding a near-duplicate query) and returns `required_fields` alongside `session`/`consultant_persona`. `ConsultationWorkflow.submit_message` (`workflows.py`) adds `required_fields` to the graph's `state` dict. `ConsultantTurnState` (`graphs.py`) gains `required_fields: list[dict]`.

### 3. Dynamic per-turn schema, only when `required_fields` is non-empty

`orchestrator/app/consultations/graphs.py`:
```python
from pydantic import BaseModel, Field, create_model

_FIELD_TYPE_MAP = {"string": str, "number": float, "boolean": bool}

def _build_turn_output_schema(required_fields: list[dict]) -> type[BaseModel]:
    """ConsultantTurnOutput unchanged when required_fields is empty (e.g.
    research_debate) — stays exactly as free-form as today. Only case types
    with a real schema (loan_approval) get the strict, fully-enumerated
    variant, since that's the only case OpenAI's strict mode can actually
    validate (ADR 0010 decision 2)."""
    if not required_fields:
        return ConsultantTurnOutput
    case_data_fields = {
        f["name"]: (_FIELD_TYPE_MAP[f["type"]], Field(description=f["description"]))
        for f in required_fields
    }
    CaseData = create_model("CaseData", **case_data_fields)
    return create_model(
        "ConsultantTurnOutputStrict",
        proposed_payload=(CaseData | None, None),
        __base__=ConsultantTurnOutputBase,
    )
```
`schemas.py` gains a new `ConsultantTurnOutputBase` (`message`/`ready_to_finalize` only), and today's `ConsultantTurnOutput` becomes a subclass of it (`proposed_payload_json` only, nothing else changes — every existing import of `ConsultantTurnOutput` keeps working unchanged):
```python
class ConsultantTurnOutputBase(BaseModel):
    message: str
    ready_to_finalize: bool = False

class ConsultantTurnOutput(ConsultantTurnOutputBase):
    proposed_payload_json: str | None = Field(default=None, description="...")  # unchanged
```

`_draft`/`_revise` each: build the schema via `_build_turn_output_schema(state["required_fields"])`, call `.with_structured_output(schema)`, then normalize the result back to a plain `dict | None` regardless of which schema variant fired — so every other consumer (workflow, persistence, frontend) is completely unaffected by this change:
```python
if state["required_fields"]:
    proposed_payload = response.proposed_payload.model_dump() if response.proposed_payload else None
else:
    proposed_payload = json.loads(response.proposed_payload_json) if response.proposed_payload_json else None
proposed_payload = _compute_derived_fields(state["case_type"], proposed_payload) if proposed_payload else proposed_payload
```

### 4. DTI as a deterministic derived field, not a schema field

```python
def _compute_derived_fields(case_type: str, payload: dict) -> dict:
    """Explicit, not a generic formula engine (ADR 0010 decision 3) — the
    only derived field today is loan_approval's DTI. monthly_debt/
    monthly_income are ordinary required fields the consultant collects;
    dti_ratio is computed here and merged in, never asked of or produced
    by the model, so it can't be arithmetically wrong."""
    if case_type == "loan_approval" and payload.get("monthly_income"):
        payload = {**payload, "dti_ratio": round(payload["monthly_debt"] / payload["monthly_income"], 4)}
    return payload
```
`dti_ratio` is **not** listed in `loan_approval`'s `required_fields` — the consultant never sees it as something to ask about or produce; it only ever appears after this function runs.

### 5. `loan_approval`'s actual `required_fields` data (seeded via Django shell, matching this project's existing no-migrations-for-config-data pattern)

```json
[
  {"name": "monthly_income", "type": "number", "description": "Applicant's gross monthly income in USD"},
  {"name": "monthly_debt", "type": "number", "description": "Applicant's total existing monthly debt payments in USD"},
  {"name": "credit_score", "type": "number", "description": "Applicant's credit score (FICO)"},
  {"name": "loan_amount", "type": "number", "description": "Requested loan amount in USD"},
  {"name": "collateral", "type": "string", "description": "What secures the loan, if anything (or 'none')"}
]
```
`research_debate.required_fields` set explicitly to `[]` (confirms current free-form behavior, doesn't rely on the field's default matching by coincidence).

## Explicitly out of scope

`policy_context`'s actual content and consumption (debate participant/judge prompts) — spec 2. New/changed participant personas, the `research_debate` participant-config data-consistency fix — spec 2. Any generic "derived field" formula system beyond DTI (ADR 0010 decision 3). Any change to `ConsultantCritique`/the critique step — it never touches `proposed_payload`.

## Verification plan

- Backend: `python manage.py makemigrations` runs clean (confirm the rename prompt is answered correctly, not silently generating an add+drop); `python manage.py migrate` applies cleanly against the real DB; regenerated `generated_tables.py` diffed by eye against the previous version (only the expected column rename + new column, no unrelated drift).
- Real consultation turn against `loan_approval`: confirm the consultant now asks about (or can be told) `monthly_income`/`monthly_debt`/`credit_score`/`loan_amount`/`collateral`, and that trying to push it to finalize before all five are present in the conversation fails structurally (not just "the model chose not to") — check the actual DB-persisted turn/response shape, not just the visible message.
- Confirm `dti_ratio` appears in the final `proposed_payload` once `monthly_income`/`monthly_debt` are both present, computed correctly (cross-check the arithmetic against what was actually said), and that the consultant's own message text never states/asks for a DTI number itself.
- Regression check: a fresh `research_debate` consultation still accepts a fully free-form payload shape exactly as before — the dynamic-schema branch must not fire for this case type.
- Confirm `approve_consultation`/`create_case_and_debate` still works unchanged end-to-end (a full consultation → approve → real debate flow), since `finalized_payload` is still just a plain dict by the time it reaches that path.

## Branch

Continuing on `main`.

## Found during implementation

`makemigrations`, piped `y` via heredoc stdin, did **not** trigger Django's interactive rename-detection prompt as expected — it generated a plain `RemoveField` + `AddField` pair instead of a `RenameField`. Caught before applying (`--check --dry-run` is what should show zero drift, not the migration file's raw contents alone) — hand-corrected the freshly-generated migration file to use `RenameField` + `AlterField` (for the updated help text), then re-ran `makemigrations --check --dry-run` and confirmed it now reports "No changes detected," proving the hand-corrected migration produces the exact same end schema the model declares. This is editing a migration the generator just produced to fix a real behavioral gap in the automation, not hand-writing what the generator should have produced — consistent with this project's scaffold-first rule.

`sqlacodegen` needed the `.env` file's `DATABASE_URL` scheme adjusted from `postgres://` to `postgresql://` for this one-off local run (SQLAlchemy 2.x no longer registers the bare `postgres` dialect name) — not a change to the committed `.env`, just the value used for this specific command.

## Found during verification

No bugs. One clarification worth recording, since the spec's own verification-plan wording ("the consultant's own message text never states/asks for a DTI number itself") turned out to be an overclaim: the *persisted, structured* `dti_ratio` is guaranteed deterministic and was confirmed correct in every run — but nothing constrains the consultant's free-text `message` field, which in one real-browser run did narrate "your debt-to-income ratio is 30%" as conversational commentary (correctly, in that instance, since it's simple arithmetic on values it already had — but this narration was never guaranteed correct the way the structured field is). This is pre-existing, unconstrained free-text behavior, not a regression or gap this spec introduced or was meant to close — the goal was specifically that the *authoritative, persisted* value can't be wrong, which holds.

Verified end to end:
- Direct API calls against a real `loan_approval` consultation: an explicit "finalize now" push with zero fields answered was refused, naming the exact 5 required fields; providing all 5 then finalized (`ready_to_finalize: true`) on the same turn; the real, persisted `Case.payload` (via a full approve → real Case + Debate flow) contained all 5 fields plus `dti_ratio: 0.3`, matching `1800 / 6000` exactly.
- Regression check via the same method against `research_debate`: an identical "finalize now" pressure tactic finalized immediately with a genuinely free-form payload shape, no schema constraint, no `dti_ratio` — confirmed unaffected.
- Real browser, fresh test user: reproduced both flows through the actual UI — the 5-field refusal, the correct finalize once complete (with an extra confirmation round from the pre-existing critique/reflection mechanism, spec 0023 — orthogonal to this spec, not a new bug), a real "Approve and start debate" click landing on a genuine new debate page; `research_debate` confirmed genuinely free-form through the UI too. Zero console errors.
- Incidentally confirmed, not the point of this spec: `research_debate`'s `default_participant_personas` is still empty at the DB level — approving a `research_debate` consultation failed with `CaseTypeConfig 'research_debate' has no default_participant_personas configured`, exactly the gap ADR 0010 already flagged as spec 2's job. Not fixed here, logged in `TODO.md`.
- 29 Angular tests pass — this spec is backend/orchestrator-only, the frontend's `SubmitMessageResponse` contract (`message`, `ready_to_finalize`) is completely unchanged.

## Status

Implemented and verified against the real running stack, backend/orchestrator only. Closes ADR 0010's part 1 of 2. Part 2 (debate-side `policy_context` injection, dedicated `loan_approval` personas, the `research_debate` participant-config fix) is done in [docs/specs/0031-debate-side-policy-grounding-and-loan-personas.md](docs/specs/0031-debate-side-policy-grounding-and-loan-personas.md) — ADR 0010 is fully closed.
