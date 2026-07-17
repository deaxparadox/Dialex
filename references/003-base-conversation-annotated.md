# Base Conversation — Annotated (speaker-labeled reconstruction)

> This is a **reconstruction** of [001-base-conversation-claude-web.md](./001-base-conversation-claude-web.md) with speaker turns split out, built by inferring turn boundaries from content/tone shifts and the `Q:`/`A:` markers in the original text (the source copy/paste lost all turn breaks), then completed with a full section (data model, judge-directed turn-taking decision, judge-as-moderator lifecycle, DB access pattern, WebSocket confirmation) that was missing from `001` entirely and supplied later via screenshot/paste (likely cause: a browser select-and-scroll copy dropped a middle section of the page — exact mechanism unconfirmed). `001` is intentionally left as the original, incomplete verbatim paste — this file (`003`) is the complete, accurate record and is the one to read going forward.

---

**You:**
> Multi-Agent Debate/Consensus System
> What it does: Multiple LLM agents with different personas/perspectives argue out a decision (e.g., "should we approve this loan," "is this code PR safe to merge") and a judge service synthesizes a final verdict with reasoning transparency.
> Services: Agent Pool (each with distinct system prompts/roles), Debate Orchestrator, Judge/Synthesis Service, Memory Service (tracks argument history)
> Why it's interesting: forces you to solve real distributed coordination problems (turn-taking, convergence detection, disagreement resolution) — not just "call an LLM and return JSON"
>
> I like project idea

**Claude:**
> Nice pick — this one has real distributed-systems teeth to it, not just API-wrapper busywork. Let me sketch how I'd actually break this down so it's buildable in stages rather than a big-bang design.
>
> **Core hard problems (the actual meat)**
> - Turn-taking / orchestration — who speaks when, sequential vs parallel rounds, how much context each agent sees of others' arguments
> - Convergence detection — how do you know the debate is "done"? Fixed rounds? Similarity scoring between successive positions? Judge polling?
> - Disagreement resolution — when agents don't converge, does the judge force a verdict, escalate, or return "no consensus" with a confidence score?
> - State/memory — argument history needs to be queryable (who said what, when, in response to what) — this smells like an event log, not just a chat array
> - Reasoning transparency — you're not just returning a verdict, you're returning why, with a traceable path back to which arguments moved the needle
>
> **Suggested architecture**
> ```
> ┌─────────────────┐
> │  API Gateway     │  ← submits case, polls status, gets verdict
> └────────┬─────────┘
>          │
> ┌────────▼─────────┐
> │ Debate Orchestrator│  ← state machine: OPEN → ARGUING → CONVERGING → JUDGED
> └────────┬─────────┘
>          │
>     ┌────┴────┬──────────┬──────────┐
>     ▼         ▼          ▼          ▼
>  Agent A   Agent B    Agent C   Memory/Event
>  (role X)  (role Y)   (role Z)  Log Service
>     │         │          │
>     └────┬────┴──────────┘
>          ▼
>    Judge/Synthesis Service
> ```
> - Orchestrator owns the state machine and round logic — this is the piece I'd design most carefully
> - Agents are stateless workers: given (case, full argument history, their persona), return next argument. Keeps them horizontally scalable and swappable (different models per agent, even).
> - Memory service is an append-only event log (case_id, round, agent_id, argument, timestamp, responds_to) — lets you replay a debate or audit it later
> - Judge runs after convergence criteria trips, and should cite which arguments it weighted, not just emit a verdict
>
> **Questions that'll shape everything else**
> Rather than guess, want to lock in a few decisions first? These change the orchestrator design a lot:
>
> Q: How should agents take turns?

**You:**
> A: I think we should have all three options as section before the start a debate

**Claude:**
> Q: What tech stack are you thinking?

**You:**
> A: python (django or fastapi for backend) and anguar for frontend, since I'm going with angular, core will be django in async, let me know your throughts

**Claude:**
> Q: What's the first concrete use case to build against?

**You:**
> A: Loan approval

**Claude:**
> Good choices — let me react to each before we get into structure.
>
> **Turn-taking as a configurable strategy**
> Making this selectable per-debate rather than baked in is the right call — it also forces you to design the orchestrator around a clean interface instead of hardcoding control flow. This maps naturally to a strategy pattern:
> ```python
> class TurnStrategy(ABC):
>     async def next_speakers(self, debate_state) -> list[AgentId]: ...
>     async def is_round_complete(self, debate_state) -> bool: ...
>
> class SequentialStrategy(TurnStrategy): ...   # A→B→C, each sees prior
> class ParallelStrategy(TurnStrategy): ...      # all speak, then all see each other
> class JudgeDirectedStrategy(TurnStrategy): ... # judge picks next speaker dynamically
> ```
> The orchestrator's state machine just asks the active strategy "who goes next" and "are we done with this round" — it doesn't need to know the difference. This is genuinely the most interesting part of the whole system, so good instinct to keep it open rather than commit early.
>
> **Django async vs FastAPI — my honest take**
> This is worth pushing back on a little. A few things to weigh:
>
> Django async is real but half-finished. Async views/middleware exist since 3.1, but the ORM's async support (aget, acreate, etc.) is newer and still has rough edges — and the moment you touch a sync-only third-party package or admin internals, Django silently falls back to thread-pool execution, which defeats the point in a system that's fundamentally about concurrent long-running LLM calls (agents calling out to models in parallel, orchestrator waiting on multiple futures).
>
> What you actually need here: lots of concurrent I/O-bound waiting (agent LLM calls, judge calls), a long-lived debate process (a "debate" isn't a single request/response — it spans many rounds over potentially minutes), and probably WebSockets or SSE so the Angular frontend can watch a debate unfold live rather than polling.
>
> That points more toward FastAPI + native asyncio for the core orchestrator, possibly with:
> - Celery isn't ideal here — it's designed for fire-and-forget tasks, not stateful multi-turn orchestration with branching logic
> - A dedicated async orchestrator process driven by asyncio tasks per debate, or a lightweight state machine backed by Redis/Postgres for durability (so a debate survives a server restart)
>
> My actual recommendation: Django REST Framework for the boring CRUD stuff (users, case submission, historical debate records, auth) since Django's admin and ORM migrations are genuinely great for that — but run the Debate Orchestrator and Agent Pool as a separate FastAPI/asyncio service. They talk over a queue or internal API. Django owns persistence and the public API surface; FastAPI owns the concurrent real-time orchestration.
>
> Angular frontend fits either way, no issue there.
>
> Want me to sketch this as a concrete repo structure (services, models, one worked example of the loan-approval debate end to end), or do you want to defend the Django-monolith approach first? Either way I think we should nail the data model next since it underpins both the event log and the judge's transparency requirement — happy to start there.

**You:**
> Django for cruds operations.
> Fastapi for orchestration
> Agnular for UI

**Claude:**
> Good — that's a solid split. Let's lock down the data model next, since it's shared infrastructure both services depend on (Django writes/reads it for CRUD and history, FastAPI writes to it during live orchestration).
>
> **Core entities**
> ```
> Case
>  ├─ id, type (loan_approval, pr_review, ...), payload (JSON), status, created_by, created_at
>
> Debate
>  ├─ id, case_id (FK), turn_strategy (sequential|parallel|judge_directed)
>  ├─ status (OPEN, ARGUING, CONVERGING, JUDGED, NO_CONSENSUS, FAILED)
>  ├─ current_round, max_rounds, convergence_config (JSON)
>  ├─ created_at, judged_at
>
> AgentPersona
>  ├─ id, name, role_description, system_prompt, model_config (which LLM, temp, etc.)
>
> DebateParticipant
>  ├─ debate_id (FK), agent_persona_id (FK), stance_seed (optional initial bias)
>
> Argument   ← the event log, append-only
>  ├─ id, debate_id (FK), round_number, agent_persona_id (FK)
>  ├─ content, responds_to (FK to Argument, nullable)
>  ├─ position (approve/reject/uncertain + confidence score — structured, not just free text)
>  ├─ created_at
>
> ConvergenceCheck   ← audit trail of orchestrator's "are we done" decisions
>  ├─ id, debate_id (FK), round_number, method (similarity|fixed_rounds|judge_poll)
>  ├─ result (converged/not), score, created_at
>
> Verdict
>  ├─ id, debate_id (FK, one-to-one), decision, confidence
>  ├─ reasoning (text — judge's synthesis)
>  ├─ cited_arguments (M2M or JSON array of Argument ids)  ← the transparency requirement
>  ├─ created_at
> ```
> **Key design decisions baked into this**
> 1. `Argument.position` is structured, not just prose. If each argument carries a machine-readable stance (approve/reject/uncertain) plus a confidence float, convergence detection becomes tractable — you can literally check "have positions stabilized across N rounds" via variance on confidence scores, rather than trying to do semantic similarity on free text every round (which is expensive and fuzzy). You'd still keep the free-text content for the actual argument, but the structured field is what the orchestrator's convergence strategy reads.
> 2. `responds_to` makes the event log a DAG, not a flat list. This matters a lot for the judge's reasoning transparency — "Agent B's rejection was in direct response to Agent A's risk claim, and Agent C never rebutted it" is a much stronger transparency story than a flat transcript.
> 3. `cited_arguments` on `Verdict` is non-negotiable for your stated goal. The judge prompt should be forced (via structured output / tool calling) to point at specific Argument IDs, not just narrate. That's what makes "reasoning transparency" a real feature instead of a marketing line.
> 4. Split ownership: Django owns `Case`, `AgentPersona`, `Debate` (metadata/status), `Verdict` — the "at rest" records. FastAPI's orchestrator writes `Argument` and `ConvergenceCheck` rows during a live debate (via direct DB access or an internal API call back to Django) and flips `Debate.status` as it progresses.
>
> **One open question before I sketch the orchestrator's state machine**
> For the judge-directed turn strategy specifically — should the judge be a separate LLM call each turn just to pick the next speaker (expensive, but genuinely adaptive), or should it use a cheaper heuristic (e.g. "call whichever agent hasn't rebutted the latest argument") and only invoke the full judge for final synthesis?

**You:**
> Not sure — want your recommendation

**Claude:**
> My recommendation: **cheap heuristic during the debate, full judge only at the end.**
>
> **Why**
>
> The "judge-directed" strategy's value isn't really about the judge having exquisite taste in who speaks next — it's about breaking the rigid A→B→C pattern so the debate can react to what's actually happening (e.g., "the risk-focused agent hasn't addressed the latest counter-argument, call them back"). You can get 90% of that adaptiveness from cheap signals instead of paying for a full reasoning LLM call on every single turn:
>
> **Heuristic signals that are basically free (no LLM call needed):**
> - Who hasn't spoken yet this round → speak
> - Whose last argument was directly rebutted (via `responds_to`) but they haven't responded → speak
> - Whose position has the widest confidence gap from the current mean → speak (the "most dissenting" voice gets priority)
> - Round-robin fallback if nothing else fires
>
> **Where a real LLM call earns its cost:** the *final* synthesis, where you actually need judgment — weighing arguments against each other, producing the structured verdict with cited arguments, and reasoning transparency. That's a fundamentally different task from routing, and it's the one place quality directly drives your product's value.
>
> **The pragmatic reason this matters for you specifically**
>
> You're building three turn strategies to compare/showcase in the same system. If judge-directed costs 5-10x more per debate (LLM call every turn) than sequential/parallel, it stops being a fair comparison — you'd be comparing "adaptive but expensive" against "simple but cheap" rather than isolating turn-taking quality as the variable. Keeping the heuristic cheap means all three strategies cost roughly the same, and the only thing that differs is *coordination logic* — which is the actual thing you said you wanted to explore.
>
> You can always add a config flag later (`judge_directed_mode: heuristic | full_llm`) if you want to experiment with the expensive version once the cheap one is working — that's a small orchestrator change, not an architecture change, since it's already isolated behind the `TurnStrategy` interface.
>
> With that settled, next up is the orchestrator state machine itself — the thing that ties `Debate.status`, the chosen `TurnStrategy`, and convergence checks together into an actual async loop. Want me to sketch that next, or would you rather nail down the convergence detection logic first (since it's shared across all three strategies and gates when a debate moves from ARGUING → CONVERGING → JUDGED)?

**You:**
> I didn't get muc of hte above

**Claude:**
> No problem — let me slow down and explain it plainly.
>
> **The question was:** in "judge-directed" mode, when it's time to pick who argues next, should we ask a full AI model to decide every single time (expensive, slow), or use a simple rule-based shortcut most of the time and only bring in the real AI judge at the very end for the final verdict?
>
> **My answer: use simple rules during the debate, save the real AI judge for the final decision only.**
>
> Here's the plain version of why:
>
> **1. Calling an LLM every turn is overkill for "who speaks next."**
> Picking the next speaker doesn't need deep reasoning — it needs simple bookkeeping. For example:
> - If someone hasn't spoken yet this round → let them speak
> - If someone's argument just got directly challenged and they haven't responded yet → let them respond
> - If someone still strongly disagrees with everyone else → give them priority
>
> None of that needs an AI call — it's just checking data you already have (who spoke, who got rebutted, whose opinion differs most). Basic code, not AI.
>
> **2. Save the expensive AI reasoning for where it actually matters — the final verdict.**
> The judge's real job is: look at the whole debate, decide who made the better case, and explain why. That's the part that genuinely needs a smart model. Picking speaking order doesn't.
>
> **3. Practical reason specific to your project:**
> You're building three different turn-taking styles (sequential, parallel, judge-directed) so you can compare them. If judge-directed calls the AI on every turn, it'll cost way more than the other two — so any comparison between them becomes unfair (you're not comparing "coordination style," you're comparing "cheap vs expensive"). Keeping all three similarly cheap means the comparison is actually meaningful.
>
> Does that make sense? If yes, next step is deciding how the system knows a debate is "finished" (called convergence detection) — want me to explain that one plainly too, or was it something else in the earlier message that was unclear?

**You:**
> let go with start and last, at the start judge will describe what we are doing today, and at the endpoint will summarize result.

**Claude:**
> Got it — so the judge acts like a moderator: opens the debate with a framing statement, stays quiet during the actual arguing (routing is handled by cheap heuristics), then closes with the verdict + summary. That's a clean, cheap, and very presentable design — the judge's two appearances are also the two moments a user would actually want to read carefully.
>
> Let me fold this into the flow:
>
> **Revised debate lifecycle**
> ```
> 1. OPEN
>    → Judge generates an "opening statement": restates the case,
>      names the participating agents/personas, states what
>      they're being asked to decide, and what "convergence"
>      will look like for this debate.
>
> 2. ARGUING (rounds happen here)
>    → Turn strategy (sequential / parallel / judge-directed-heuristic)
>      decides who speaks each round.
>    → Judge does NOT speak here. No LLM judge calls during rounds.
>
> 3. CONVERGING
>    → After each round, a cheap convergence check runs
>      (e.g. position stability across last N rounds, or max_rounds hit).
>    → If converged (or max rounds reached) → move to JUDGED.
>    → Otherwise → back to ARGUING for another round.
>
> 4. JUDGED
>    → Judge makes ONE full LLM call: reads the entire argument
>      history (the DAG), produces the verdict, confidence,
>      reasoning, and cites specific Argument IDs it weighed most.
>    → This is also where the "closing summary" text is generated —
>      same call, just structured to return both the verdict AND
>      a human-readable summary.
> ```
>
> **What this means for the data model**
>
> One small but important addition: the judge's opening statement needs a home. I'll add it as a field on `Debate` rather than treating it as an `Argument` (since it's moderation, not a stance in the debate):
> ```
> Debate
>  ├─ ... (existing fields)
>  ├─ opening_statement (text, set when status → OPEN)
>  ├─ closing_summary (text, set when status → JUDGED)
> ```
> `Verdict` stays as-is for the structured decision (decision, confidence, cited_arguments) — `closing_summary` is the readable narrative version, `Verdict` is the queryable structured version. Frontend shows both together.
>
> **One clarification I need**
>
> When you say "at the start" — should the judge's opening statement happen **once per debate**, generated fresh by an LLM call reading the `Case` payload? Or could it be a **template** (fill-in-the-blanks, no LLM call) since it's fairly mechanical ("Today we're deciding on loan application #123 with agents X, Y, Z")?

**You:**
> LLM call (more natural, costs a little)

**Claude:**
> Good — the opening statement is one of only two moments the user actually reads closely, so it's worth the small cost to have it framed naturally rather than looking like a mail-merge.
>
> **Updated lifecycle (final version)**
> ```
> 1. OPEN
>    → Judge LLM call #1: reads the Case payload + participating
>      AgentPersonas, writes an opening statement — restates the
>      case, introduces the agents/roles, states what's being
>      decided and what convergence looks like.
>    → Debate.opening_statement saved. Status → ARGUING.
>
> 2. ARGUING (rounds)
>    → Turn strategy decides speakers (sequential / parallel /
>      judge-directed-heuristic). No LLM judge calls here.
>    → Each Argument saved with structured position + confidence.
>
> 3. CONVERGING
>    → Cheap check after each round (position stability or
>      max_rounds hit). Loop back to ARGUING or advance.
>
> 4. JUDGED
>    → Judge LLM call #2: reads full Argument DAG, produces
>      structured Verdict (decision, confidence, cited_arguments)
>      AND the closing_summary narrative in the same call.
>    → Debate.closing_summary + Verdict saved. Status → JUDGED.
> ```
> So: **2 guaranteed LLM calls for the judge** per debate (open + close), regardless of turn strategy — plus N calls for the arguing agents themselves. That's a predictable, comparable cost across all three strategies, which keeps your original goal intact.
>
> **Where we are**
>
> Data model and lifecycle are now solid enough to build against. Next natural step is the FastAPI orchestrator's actual async implementation — the state machine, the `TurnStrategy` interface, and how it talks to Django for persistence. A few sub-decisions I'll need from you when we get there:
> - Does FastAPI write directly to the same Postgres DB Django uses (simplest, but couples the two services tightly to Django's schema), or does it go through an internal Django API (cleaner separation, more latency)?
> - Real-time updates to Angular — WebSocket per debate, or polling an endpoint?
>
> Want me to go ahead and scaffold the actual project structure (Django app, FastAPI service, shared models) so you've got something running, or talk through those two questions first?

**You:**
> for database related thing, it's a quiet good question, if we are selecting different database, we redunding few column related to users info, for in same column, we have to takle model and raw queries, few model will the in django few will be in fastapi, and both system will need to right raw queries for referencing.
> websocket

**Claude:**
> You've basically talked yourself into the right answer already — let's confirm the reasoning so it's a solid decision, not just a default.
>
> **Same database, different access patterns**
>
> You're right that "different databases" creates real pain (duplicated user/auth data, no foreign key integrity across services, sync headaches). But "same database, Django owns the schema" doesn't mean FastAPI has to write raw SQL everywhere either — there's a middle path:
>
> **Django owns all migrations.** Every table (`Case`, `Debate`, `AgentPersona`, `Argument`, `ConvergenceCheck`, `Verdict`) is defined once, as Django models, in one place. This is your single source of truth for schema — no drift, no duplicate migration systems fighting each other.
>
> **FastAPI reads/writes the same tables via SQLAlchemy Core (not ORM), using async engine + asyncpg.** Not raw string SQL, but not a second ORM with its own model definitions either:
> ```python
> # FastAPI side — reflects existing tables, no schema ownership
> from sqlalchemy import Table, MetaData
> from sqlalchemy.ext.asyncio import create_async_engine
>
> metadata = MetaData()
> argument_table = Table("debates_argument", metadata, autoload_with=engine)
>
> # Type-safe-ish, composable, async — not raw strings
> stmt = argument_table.insert().values(
>     debate_id=debate_id, round_number=round_num,
>     agent_persona_id=agent_id, content=text, position=stance
> )
> await conn.execute(stmt)
> ```
> This gets you:
> - **One schema, one migration history** (Django's `makemigrations`/`migrate`) — no fighting over who owns what
> - **FastAPI still gets async, composable queries** — not hand-written SQL strings scattered through orchestration code, which would be a maintenance nightmare given how much writing happens during a live debate (every argument, every convergence check)
> - **No duplicated user/auth data** — Django's `auth_user` table stays canonical; FastAPI just references `created_by_id` as a foreign key when needed, never owns identity
>
> The one discipline you'll need: **FastAPI never runs migrations, and never writes to a table Django doesn't already know about.** Any new field goes into a Django model first, migrate, then FastAPI's reflected table picks it up automatically (or you hand-declare the SQLAlchemy Table matching Django's schema, which is more explicit and doesn't need a live DB reflection call on startup — probably the better move for production).
>
> **WebSockets — confirmed, and how it fits**
>
> Since FastAPI is already async and owns orchestration, it's the natural WebSocket host too:
> ```
> Angular client
>    │ connects to
>    ▼
> FastAPI: ws://.../debates/{debate_id}/stream
>    │
>    │  as orchestrator writes each Argument / status change,
>    │  it pushes an event over the socket:
>    │  {"type": "argument", "data": {...}}
>    │  {"type": "status_change", "data": {"status": "CONVERGING"}}
>    │  {"type": "verdict", "data": {...}}
>    ▼
> Angular subscribes, updates the debate view live
> ```
> Django's REST API is still what Angular hits for **history** (past debates, case CRUD, agent persona management) — the WebSocket is purely for the live, in-progress view. Clean split: Django = REST + data at rest, FastAPI = WebSocket + data in motion.
>
> Want me to scaffold the actual repo now — Django models + FastAPI service skeleton + the WebSocket endpoint stub — so you have something to run and iterate on? Or is there another design piece you want to nail down first (e.g. the convergence detection logic itself)?

**You:**
> ok, it's make more sense,

**Claude:**
> Good — glad it landed. Let's keep going in the same order: convergence detection next, since it's the one piece every turn strategy depends on, then we scaffold code.
>
> **Convergence detection — the actual logic**
> The core idea: after each round, check if the debate has "settled" using the structured position + confidence fields on Argument (not expensive text similarity).
>
> Signals to combine:
> - Position stability — has each agent's stance (approve/reject/uncertain) stopped flipping across the last 2 rounds?
> - Confidence convergence — is the spread of confidence scores across agents shrinking? (e.g. round 1: confidences are [0.9, 0.2, 0.6] — wide disagreement; round 3: [0.85, 0.8, 0.82] — everyone's aligned)
> - No new rebuttals — did anyone respond (responds_to) to another agent's argument this round, or did agents just restate themselves? If nobody's engaging with counter-points anymore, further rounds won't add information.
> - Hard ceiling — max_rounds always wins regardless of the above, so a debate can never run forever (this is your safety valve).
>
> A simple, explainable scoring function (not ML, just arithmetic — keeps it auditable, which matters since you're already committed to reasoning transparency):
> ```python
> def check_convergence(debate_id, round_number) -> ConvergenceResult:
>     args_this_round = get_arguments(debate_id, round_number)
>     args_prev_round = get_arguments(debate_id, round_number - 1)
>
>     # Signal 1: position stability
>     positions_stable = all(
>         args_this_round[agent].position == args_prev_round[agent].position
>         for agent in participating_agents
>     )
>
>     # Signal 2: confidence spread shrinking
>     spread_now = max(a.confidence for a in args_this_round) - min(a.confidence for a in args_this_round)
>     spread_prev = max(a.confidence for a in args_prev_round) - min(a.confidence for a in args_prev_round)
>     spread_shrinking = spread_now < spread_prev
>
>     # Signal 3: engagement dying down
>     new_rebuttals = sum(1 for a in args_this_round if a.responds_to is not None)
>
>     converged = positions_stable and spread_shrinking and new_rebuttals == 0
>     score = (1 if positions_stable else 0) + (1 if spread_shrinking else 0) + (1 if new_rebuttals == 0 else 0)
>
>     return ConvergenceResult(converged=converged, score=score / 3, signals={...})
> ```
> Every check gets logged as a ConvergenceCheck row — so if a user asks "why did the debate stop after round 3," you can show them the actual signals, not just a black-box "trust me."
>
> One important edge case: what happens when max_rounds is hit but agents never converged? That's your NO_CONSENSUS path — the judge still produces a verdict (forced decision), but the confidence should reflect the lack of agreement, and the closing summary should say so honestly ("agents did not reach consensus; final verdict reflects majority position with low confidence") rather than pretending it was clean.
>
> **Question before I scaffold**
> For the parallel strategy specifically, since all agents speak "simultaneously" each round with no visibility into each other's current round argument — do you want:
>
> Q: In parallel mode, what do agents see when forming their argument?

**You:**
> A: both case are fine share conversation for each other previous argument reference or independent argument based on question.

**Claude:**
> Makes sense — you want both modes available, not a single fixed behavior. That's actually a nice parallel to how you handled turn-taking strategy (make it a config choice, not a hardcoded rule). Let's treat it the same way.
>
> **Parallel strategy — two sub-modes**
> `ParallelStrategy(visibility="blind" | "shared_after_round")`
>
> - **blind** — each agent only sees arguments from prior completed rounds. Within the current round, all agents are queried concurrently (asyncio.gather), each blind to what the others are saying right now. This gives you truly independent reasoning per round — good for reducing groupthink/anchoring, useful if you want to measure "did agents converge on their own vs because they copied each other."
> - **shared_after_round** — same concurrent dispatch, but before the round is marked complete, every agent gets a second pass: shown the round's arguments and asked to react/refine before the round finalizes. Basically: draft → reveal → revise. More conversational, closer to how a real debate feels, but costs 2x LLM calls per round per agent.
>
> ```python
> class ParallelStrategy(TurnStrategy):
>     def __init__(self, visibility: Literal["blind", "shared_after_round"] = "blind"):
>         self.visibility = visibility
>
>     async def run_round(self, debate_state):
>         # Round 1: everyone drafts concurrently, blind to each other
>         drafts = await asyncio.gather(*[
>             agent.argue(debate_state.history_up_to_prior_round)
>             for agent in debate_state.participants
>         ])
>
>         if self.visibility == "blind":
>             return drafts  # final, no revision pass
>
>         # shared_after_round: reveal drafts, let everyone revise once
>         revised = await asyncio.gather(*[
>             agent.argue(debate_state.history_up_to_prior_round + drafts, is_revision=True)
>             for agent in debate_state.participants
>         ])
>         return revised
> ```
> Both modes store the same Argument rows either way — the difference is purely in what context gets built before each agent's LLM call. Debate.convergence_config (already in your data model) is a natural home for this setting alongside turn_strategy.
>
> This keeps the TurnStrategy interface clean — it's still just "give me the arguments for this round" from the orchestrator's point of view, regardless of which visibility mode is running underneath.
>
> I think the design is solid enough now to start building. Let me scaffold:
> - Django project — models for all entities, DRF serializers/viewsets for CRUD, admin registration
> - FastAPI service — orchestrator skeleton, TurnStrategy classes (all three + parallel's two sub-modes), WebSocket endpoint, shared DB access layer
> - A minimal Angular shell that can submit a loan case and watch a debate stream live
>
> Want me to build this as an actual runnable repo, or do you want to see the Django models + FastAPI orchestrator code first as a review step before I wire up the full thing?

**[End of pasted conversation — no reply captured after this final question]**
