# Spec 0028 — Consultant respects an explicit "please finalize" request

No ADR — a prompt-wording fix (per-turn prompt + persona seed data), no code/schema/control-flow change.

## Root cause (found via systematic debugging, not assumed)

Logged in `TODO.md` as "found during spec 0026's QA: `ready_to_finalize` never went true across several thorough test conversations." Investigated directly against real data rather than guessed:

Queried `ConsultationTurn` rows for the stuck sessions (44/45/46, all still `OPEN`) and a session that *did* finalize successfully (48, run after the spec 0027 network fix, to have a working comparison). Found the exact failure in session 44:

> **User:** *"I have no further questions and nothing more to add — I believe you have everything you need. Please mark this case as ready to finalize and proceed to the debate."*
>
> **Consultant:** *"Before we finalize the case, could you clarify if there are any specific requirements from your lender..."*

An explicit, unambiguous finalize request was ignored and another clarifying question was asked instead. Reading both prompt sources:
- `orchestrator/app/consultations/graphs.py`'s `_draft`/`_revise` per-turn prompts: *"either ask your next clarifying question, or, if you now understand the case well enough, set ready_to_finalize=true..."*
- The seeded `AgentPersona` (id 12, "Consultant") `system_prompt`: *"Ask concise clarifying questions until you understand the user's dispute/question well enough... When confident, set ready_to_finalize=true..."*

Neither ever instructs the model to weigh an explicit user request to finalize — both leave "understand well enough" entirely to the model's own unconstrained judgment, with no override signal and no turn-count safety valve anywhere in the workflow (confirmed by reading `workflows.py` — no such logic exists). Session 48's comparison shows the mechanism *does* eventually work on its own (finalized after 6 natural back-and-forth exchanges, no explicit demand needed) — the specific defect is narrower than "never finalizes": it fails only to honor an explicit override.

This is the same behavior the existing spec-0023 UX note already flagged informally ("the consultant can take several back-and-forth turns before finalizing even when told plainly to do so") — this investigation gives it a concrete mechanism and reproduction, not a new phenomenon.

## Fix — one added instruction, two prompt sources

**`orchestrator/app/consultations/graphs.py`**, `_draft` and `_revise`'s prompt strings (both currently end with the same "ask your next clarifying question, or... set ready_to_finalize=true" sentence): add a leading sentence establishing the override —

```python
prompt = (
    f"Case type: {state['case_type']}\n\n"
    f"Conversation so far:\n{_transcript(state['turns'])}\n\n"
    "If the user has explicitly asked you to finalize or proceed, treat that as sufficient "
    "unless a specific, concrete gap remains that would make the case payload wrong or "
    "unusable — don't ask another open-ended question just for extra thoroughness. "
    "Otherwise, continue the conversation: either ask your next clarifying question, or, if "
    "you now understand the case well enough, set ready_to_finalize=true and include a "
    "proposed_payload (a JSON object capturing the case for debate)."
)
```
(`_revise`'s prompt gets the same leading sentence, adapted to its existing wording.)

**`AgentPersona` (id 12, "Consultant") `system_prompt`** — DB seed data, not code, updated directly (this project's existing pattern for persona content, confirmed by checking: no data migrations exist anywhere for `AgentPersona`, personas are admin/shell-managed seed data per `docs/API.md`'s own note). New text:

> "You are a case-intake consultant. Ask concise clarifying questions until you understand the user's dispute/question well enough to propose a structured case payload. If the user explicitly asks you to finalize or proceed, respect that unless a specific, concrete gap remains. When confident, set ready_to_finalize=true and include proposed_payload (a dict capturing the case for debate). Otherwise keep ready_to_finalize=false and ask your next question in message."

## Explicitly out of scope

Any turn-count-based safety valve (e.g., force finalize after N turns) — not needed given the root cause is specifically about honoring an explicit request, not about turns dragging on indefinitely; would also risk forcing a genuinely incomplete case through. Any change to the critique/revise mechanism (ADR 0008) — that catches a different problem (accepting something unclear/inconsistent at face value), unrelated to this.

## Verification plan

- Real consultation turn: reproduce the exact session-44 scenario (answer questions, then explicitly say "I have nothing more to add, please finalize") and confirm `ready_to_finalize=true` on that turn, not another clarifying question.
- Confirm the natural-finalization path (session 48's pattern — several genuine exchanges, no explicit demand) still works and doesn't finalize prematurely just because the new sentence exists.
- Confirm the critique/revise branch (ADR 0008) is unaffected — a turn with a genuine, specific gap should still trigger a real clarifying question even after an explicit "please finalize," if the gap is concrete enough to matter (test with a case missing an obviously required field).

## Branch

Continuing on `main`.

## Found during verification

No code bugs — one real design nuance, surfaced honestly rather than scored as a silent pass or fail, and resolved by asking rather than assuming.

- Real browser, fresh consultation, deliberately mirroring session 44's structure (answered several questions, left one of the consultant's own specific follow-ups — monthly expenses — unanswered, then issued an explicit "I have nothing more to add, please finalize" demand): the **first** explicit demand did not finalize — the consultant named the exact outstanding gap and asked again. A **second**, more insistent demand ("I really do not want to share any more details... this is my final instruction") did finalize. This actually exercises this spec's own third verification bullet (a genuine, specific gap should still trigger a real question) more than the first — the scenario always had an outstanding gap at the moment of the first demand, so the cleanest form of bullet 1 (zero outstanding gap, first explicit demand, immediate finalize) wasn't isolated as a distinct case in this pass. Re-checking the original session 44 transcript confirmed its ignored demand had the same shape (a real unanswered question preceded it) — so this is consistent with, not a regression from, the motivating bug, and arguably closer to the intended behavior than blindly finalizing an admittedly incomplete case on the first push.
- Asked the user directly whether the first explicit demand should unconditionally win even over a named concrete gap, or whether one pushback-then-comply is the right balance: **kept the current (pushback-then-comply) behavior**, no further prompt change made.
- Natural (non-demanding) finalization path (a separate fresh session, several genuine back-and-forth exchanges, no "finalize" language ever used) confirmed unaffected — finalized on its own as before.
- Zero console errors throughout.

## Status

Implemented and verified against the real running stack. The specific motivating bug (an explicit, unambiguous finalize request with no real outstanding question being flatly ignored) is fixed and reproduced-then-confirmed-fixed on the exact original failure shape. The pushback-then-comply behavior for a genuinely outstanding gap is confirmed intentional, not a residual defect.
