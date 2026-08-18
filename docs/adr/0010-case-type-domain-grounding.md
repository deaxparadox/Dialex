# ADR 0010 — Per-case-type domain grounding (required-field schemas, personas, policy context)

> Triggers the ADR bar on three counts: a data-model shift (`CaseTypeConfig` gains a `required_fields` schema and a renamed `policy_context` field, replacing the currently-unused `research_guardrail_prompt`), a new cross-cutting pattern (dynamically-built per-case-type Pydantic schemas for structured output — the first time this codebase constructs a model at runtime rather than declaring it statically), and a change that touches both the consultation and debate subsystems together. Reached via a full brainstorming conversation with the user (2026-08-18), not assumed.

## Problem, verified by reading the actual DB state before proposing anything

The user's complaint ("loan debates are weak... acting on generic loan procedure") traced to something broader than loan-specific weakness: **no case type in this system has ever had real domain grounding.** Confirmed directly against the running DB: exactly one pair of participant personas exists at all — "Pragmatist" and "Scale-minded," both written for a software-engineering decision ("favors simplicity/low ops overhead" vs. "prioritizes long-term scalability, avoiding migrations"). Every `loan_approval` debate has used this exact pair — a stark mismatch for a lending decision. `research_debate`'s `CaseTypeConfig.default_participant_personas` is currently empty even though its 3 existing debates used the same pair (a pre-existing data-consistency gap, not a deliberate config). `research_guardrail_prompt`, a field that already exists and reads like it was meant to solve exactly this, is empty for both case types today — unused. There is also no schema anywhere defining what fields a `loan_approval` intake actually needs (credit score, DTI, collateral, etc.) — the consultant free-forms it entirely.

`research_debate` only *feels* better today because its tested topics (e.g., a GraphQL migration decision) happen to overlap with what Pragmatist/Scale-minded were actually built for — not because it has any real grounding either.

## Decision 1 — A general, data-driven schema system on `CaseTypeConfig`, not a loan-only patch

Two field changes on `CaseTypeConfig`:
- New `required_fields` (JSON): a list of `{name, type, description}` — fields the consultant must actually collect (for `loan_approval`: `monthly_debt`, `monthly_income`, `credit_score`, `loan_amount`, `collateral`; for `research_debate`: `[]`, staying exactly as free-form as today).
- `research_guardrail_prompt` renamed to `policy_context` (a real migration, not a second field left alongside dead cruft) — free-text domain grounding for that case type.

Considered a code-defined static-schema-per-type registry instead (simpler, but requires a code deploy to add or change a case type's required fields) — rejected in favor of the DB-driven approach specifically because everything else case-type-specific (`position_options`, `decision_options`, `default_max_rounds`) already lives in this same table; a required-fields schema living only in code would be the one inconsistent piece in an otherwise fully admin-configurable system, and would work against the explicit goal of a *general*, reusable mechanism rather than a loan-specific one.

## Decision 2 — Enforce required fields via structured output at generation time, not a validate-after-the-fact check

At each consultant turn (`_draft`/`_revise` in `orchestrator/app/consultations/graphs.py`), the code fetches `required_fields` for the session's case type and builds a Pydantic model from it via `pydantic.create_model()` — this becomes the type of the `proposed_payload` field on that turn's structured-output schema, replacing today's free-form `proposed_payload_json: str`. The model literally cannot set `ready_to_finalize=true` while omitting a required field, because the schema it's constrained to won't validate without it — enforced by the LLM call itself, consistent with how this codebase already leans on `with_structured_output()` everywhere (ADR 0007/0008), not a new, separate validation layer bolted on afterward.

Considered keeping `proposed_payload` free-form and validating post-hoc (e.g., at `POST /consultations/{id}/approve`) — rejected: the model could still set `ready_to_finalize=true` with an invalid payload before any check caught it, reopening exactly the "consultant declares itself done when it isn't" problem spec 0028 already fixed for a different reason (ignoring explicit finalize requests). Constraining at generation time closes both gaps with the same mechanism.

## Decision 3 — DTI is a deterministic backend field, not an LLM tool call

Considered giving the consultant a bound `calculate_dti` tool (a real, bounded tool-execution loop — verified against current LangChain docs that `bind_tools()` and `with_structured_output()` don't combine in a single call, so this would need a manual loop: invoke with tools bound → execute any requested tool call → invoke again for the final structured response, similar in shape to the existing two-call split pattern from ADR 0007). Rejected for DTI specifically: `dti_ratio = monthly_debt / monthly_income` is unconditional arithmetic with a fixed formula and no judgment call about *whether* to compute it once both inputs exist — a bounded tool-call loop would add a real new mechanism to this codebase to solve a problem plain backend code already solves with zero LLM involvement and equal determinism. `monthly_debt`/`monthly_income` are collected as ordinary required fields; `dti_ratio` is computed in plain Python and merged into the payload after the structured-output call returns, never asked of or produced by the model. Not built as a generic "derived field" formula engine — DTI is the only instance of this today; a speculative generic system would be complexity ahead of need. Revisit if a second derived-field need actually arises.

## Decision 4 — Grounding flows into the whole debate, not just intake

`orchestrator/app/debates/activities.py` already fetches `case_type_config` per turn (currently only reads `position_options`/`decision_options`) — extended to also pull `policy_context` and inject it into every participant's argument-generation prompt and the judge's verdict prompt, alongside existing case/transcript context. Addresses the actual complaint directly: a participant arguing a loan case reasons against real lending guidance, and the judge weighs convergence against that same guidance — not just the consultant's intake questions being better-scoped while the debate itself stays generic.

## Decision 5 — Persona plan: dedicated personas for `loan_approval`, a data-consistency fix (not new content) for `research_debate`, judge stays shared

Two new dedicated participant personas for `loan_approval`, replacing Pragmatist/Scale-minded for this case type, mirroring the existing two-opposing-viewpoints structure: a credit-risk/compliance-focused persona (skeptical by default, weighs DTI/credit score/collateral against `policy_context`) and a relationship/growth-focused persona (looks for a legitimate path to approval — compensating factors, restructuring — still bound by the same policy guidance, not reckless). `research_debate` gets no new persona content (the user confirmed it's been working) — just a data fix, formally reassigning Pragmatist/Scale-minded as its real configured `default_participant_personas`, closing the empty-config gap without changing its behavior. The judge ("Moderator") stays shared and unchanged across all case types — its role is procedural (weigh arguments against whatever `policy_context` is now provided), not a domain viewpoint of its own.

Persona system-prompt text and the starter `loan_approval` `policy_context` are drafted by the assistant as a first pass — the user explicitly does not have deep lending-policy expertise on hand either, and asked for a draft to review/correct rather than supplying the content themselves.

## Explicitly out of scope

Human-in-the-loop "present choices with a recommendation" UX (a separate idea raised in the same conversation) — deliberately deferred to its own future design pass; this schema system is its natural foundation (the choices would come from the same required-fields definitions) but isn't designed here. Consultation resume/history (another separate idea from the same conversation) — unrelated, not touched. Any change to `research_debate`'s free-form intake behavior. A generic derived-field formula engine (Decision 3).

## Sequencing

Two specs, implemented and verified independently before the next starts, per this project's established working pattern:
1. **Data model + consultant-side intake**: `CaseTypeConfig` migration (`required_fields`, `policy_context` rename), the dynamic per-case-type Pydantic schema in the consultant graph, the DTI derived-field computation. This is the foundation everything else depends on.
2. **Debate-side grounding + persona content**: `policy_context` injection into participant/judge prompts, the new `loan_approval` personas, the `research_debate` participant-config fix.
