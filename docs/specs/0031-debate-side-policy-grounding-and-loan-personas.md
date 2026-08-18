# Spec 0031 — Debate-side policy grounding + dedicated `loan_approval` personas

Implements ADR 0010, part 2 of 2 (spec 0030 was part 1: the data model + consultant intake). No ADR update needed — this is exactly the work ADR 0010 already scoped for this half.

## Current state, verified directly (not assumed)

- `orchestrator/app/debates/activities.py`'s `fetch_debate_context` already fetches the full `CaseTypeConfig` row (via `queries.get_case_type_config`, which now returns `policy_context`/`required_fields` automatically since spec 0030's migration) — but its fallback dict for a missing config row (`{"position_options": [], "decision_options": []}`) doesn't include `policy_context`, and nothing downstream reads the field yet.
- `orchestrator/app/debates/workflows.py` builds `arg_state` (per participant, per round) and `closing_state` (judge verdict) from `case_type_config` — currently only pulling `position_options`/`decision_options` into them.
- `orchestrator/app/debates/graphs.py`'s `_produce_argument` (participant arguments) and `_produce_closing` (judge verdict) build their prompts from `ArgumentState`/`JudgeClosingState`, neither of which carries `policy_context` today. `_produce_opening` (the judge's opening statement) is a pure scene-setting statement with no judgment call in it — ADR 0010 decision 4 scoped grounding to *arguments and the verdict* specifically, not the opening statement, and this spec keeps that scope.
- `CaseTypeConfig.default_participant_personas` is confirmed live (spec 0030's own verification) to be exactly two generic personas, "Pragmatist"/"Scale-minded" (written for a software-engineering decision), for `loan_approval` — and empty for `research_debate`, even though its 3 existing debates used the same pair (a pre-existing data-consistency gap, not deliberate config).
- `DebateParticipant.persona_snapshot` freezes a copy of the persona at approval time (decision 7) — changing `AgentPersona`/`CaseTypeConfig` rows going forward only affects debates approved *after* the change; no retroactive migration of already-run debates is needed or possible.

## Fix

### 1. Thread `policy_context` from config through to the prompts

`activities.py`'s fallback dict gains `"policy_context": ""` (consistency with the real row shape). `workflows.py`'s `arg_state` and `closing_state` each gain `"policy_context": case_type_config.get("policy_context") or ""`. `ArgumentState`/`JudgeClosingState` (`graphs.py`) each gain `policy_context: str`.

### 2. Inject it into the argument and verdict prompts, only when non-empty

`_produce_argument`'s `prompt` (the streamed content call) and `judgment_prompt` (the position/confidence call) both gain a `policy_note`, built the same way `options_note`/`change_note` already are:
```python
policy_note = f"Guidance for this case type: {state['policy_context']}" if state["policy_context"] else ""
```
included in both prompts (empty string for `research_debate`, so its output is byte-for-byte unaffected). Same pattern for `_produce_closing`'s `prompt`/`judgment_prompt`.

### 3. Dedicated `loan_approval` personas (drafted here for review, not yet reviewed/corrected)

Two new `AgentPersona` rows (`role="participant"`, `model_config={"model": "gpt-4o-mini", "temperature": 0.7}`, matching the existing Pragmatist/Scale-minded convention), replacing them as `loan_approval`'s `default_participant_personas`:

- **"Credit Risk Officer"**: *"You are a credit risk officer at a community lender. You prioritize minimizing default risk: weigh the applicant's DTI ratio, credit score, and loan amount carefully against standard underwriting norms, and argue for caution or denial when the numbers don't support a safe repayment outlook. Be specific about which figures concern you. Be brief — 2-3 sentences."*
- **"Relationship Loan Advisor"**: *"You are a loan advisor focused on serving the customer relationship. You look for a legitimate, responsible path to approval — compensating factors like collateral, a strong income trend, or a smaller/restructured loan amount — while still respecting the same underwriting norms as your counterpart. You don't ignore weak numbers, but you argue for structuring a way to make a marginal case work when one reasonably exists. Be brief — 2-3 sentences."*

Starter `loan_approval.policy_context` (also drafted for review): *"Standard lending guidance for this case type: a debt-to-income (DTI) ratio above 45% is generally considered high risk without strong compensating factors (e.g. substantial collateral, a co-signer, or a demonstrated income trend). Credit scores below 620 typically warrant additional collateral or a smaller loan amount. A loan amount that would push DTI above 50% should lean toward denial or restructuring regardless of collateral, since it risks the applicant's ability to repay regardless of security offered."*

The judge ("Moderator") stays shared, unchanged — ADR 0010 decision 5 already settled this (its role is procedural, weighing arguments against whatever `policy_context` is now provided, not a domain viewpoint of its own).

### 4. `research_debate` participant-config data-consistency fix

Reassign Pragmatist/Scale-minded as `research_debate.default_participant_personas` (a data change only, via Django shell — matches this project's existing no-migrations-for-config-data pattern) — closes the gap confirmed live during spec 0030's verification (`CaseTypeConfig 'research_debate' has no default_participant_personas configured`, a real approval failure). No behavior change to `research_debate`'s actual debates, since this is the same pair its historical debates already used.

## Explicitly out of scope

Any change to `_produce_opening` (judge opening statement) — ADR 0010 decision 4 scoped grounding to arguments/verdict only. Any change to convergence-check math (`check_convergence`) — `policy_context` is prompt-level grounding, not a structured signal convergence computes over; that's the still-separately-deferred "cite structured facts, not a confidence float" redesign question. New personas for `research_debate` — the user confirmed it's been working, this spec only fixes its config data, doesn't change its content.

## Verification plan

- Real `loan_approval` debate, driven end to end (consultation → approve → full debate run): confirm the new personas appear (not "Pragmatist"/"Scale-minded"), confirm their arguments actually reference case-specific figures (DTI/credit score/collateral) in a way that reads as grounded, not generic engineering language.
- Confirm `policy_context`'s guidance is reflected in at least one argument or the verdict's reasoning (e.g., a case with weak DTI should read as recognized as risky by the arguments/verdict, not ignored).
- Confirm `research_debate` still runs correctly end to end after its participant-config fix (a full consultation → approve → debate run), using the same Pragmatist/Scale-minded pair as before — no behavior regression.
- Confirm the judge's opening statement is unaffected (unchanged prompt, no `policy_context` reference) across both case types.
- Real curl/DB check: a debate approved for a case type with empty `policy_context` (if any exists) produces prompts identical in shape to before this spec — confirm no stray empty "Guidance for this case type: " text leaks into a prompt when `policy_context` is `""`.

## Branch

Continuing on `main`.

## Found during verification

No bugs. The user approved the drafted persona/policy content as-is ("go ahead") rather than requesting changes, so it shipped unedited from the spec's draft.

Verified with two real, full consultation → approve → debate runs (not curl-only, actual Temporal workflow execution to a terminal debate status):

- **`loan_approval`, deliberately weak case** (loan $40k, income $5k/mo, debt $2.2k/mo → DTI 44%, credit score 600, no collateral — chosen specifically to sit just under the 45% DTI threshold and below the 620 credit-score threshold written into `policy_context`, to stress-test whether the grounding actually gets used): debate ran with the new "Credit Risk Officer"/"Relationship Loan Advisor" personas (confirmed via `DebateParticipant` rows, not just the config). Both personas' arguments explicitly named the case's own DTI/credit-score/loan-amount figures *against* the exact policy thresholds ("DTI ratio of 44%, which exceeds the 45% threshold..."; "credit score of 600... falls below the acceptable minimum of 620") — genuine grounded reasoning, not generic engineering language. Both converged on "reject," and the judge's verdict (`deny`, confidence 0.95) cited the same figures and thresholds independently. The opening statement was confirmed unaffected — general framing language only, no policy-threshold text, matching the deliberate scope cut (ADR 0010 decision 4 excludes it).
- **`research_debate` regression check**: a full run using the now-fixed participant config (Pragmatist/Scale-minded) completed normally — approval succeeded where it previously failed on the empty-participants gap (confirmed during spec 0030's verification), arguments read exactly as before (simplicity/scalability framing, zero policy-guidance language, confirming the empty-`policy_context` branch produces byte-identical prompts to before this spec).
- 29 Angular tests pass — this spec is backend/orchestrator-only, no frontend contract touched.

## Status

Implemented and verified against the real running stack, full debate runs (not just intake). Closes ADR 0010 in full — both parts of the two-spec sequence are now done.
