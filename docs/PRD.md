# Product Requirements Document — Multi-Agent Debate/Consensus System

> Synthesized from [references/002-design-review-findings.md](../references/002-design-review-findings.md) (all locked decisions) and [references/003-base-conversation-annotated.md](../references/003-base-conversation-annotated.md) (original design conversation). This is the source of truth for what's being built; `references/` remains the discussion trail behind it.

## 1. Summary

A system where multiple LLM agents, each with a distinct persona, debate a decision or question across several rounds, with a judge synthesizing a final, transparent, citation-backed verdict. A human always reviews the outcome before anything real happens. Built deliberately to learn microservice architecture, durable workflow orchestration, and real-time multi-agent coordination — not to ship the fastest possible wrapper around an LLM call.

## 2. Goals

- Solve real distributed-coordination problems: turn-taking, convergence detection, disagreement resolution — not just "call an LLM and return JSON."
- Support three case types from v1: `loan_approval`, `pr_review`, `research_debate`.
- Give the user a live, transparent, real-time view of a debate as it happens — not a spinner followed by a final answer.
- Use this project to deliberately learn: microservice architecture (Django + FastAPI split), durable workflow orchestration (self-hosted Temporal), and agentic reasoning frameworks (LangGraph + LangChain).

## 3. Non-goals (v1)

- No cost/rate-limiting controls on LLM or search spend (explicitly deferred — decision 19; first priority is getting the system running).
- No AutoGen/AG2 integration (deliberately set aside in favor of LangGraph — decision 3; a separate exercise outside this project if pursued).
- No enterprise-managed observability backend day one (OpenTelemetry is wired for it, but the default export target is local rotating files — decision 16).
- No hard technical enforcement against agents searching for personally-identifying case data during research — v1 relies on a prompt-level guardrail, not a technical block (decision 14).

## 4. Users

- **Case submitter** — starts a case (loan application, PR review request, or an open research question), works through the consultation flow, watches the debate live, and is often also the human reviewer.
- **Human reviewer** — reviews every debate's outcome (decision 8: no verdict is ever auto-executed) and records the actual real-world decision plus a comment.
- **Admin** — manages `AgentPersona` records (participants, consultants, judges) and `CaseTypeConfig` entries, primarily via Django admin.

## 5. Core concepts

| Entity | What it is |
|---|---|
| `Case` | A submission to be debated — has a `type` (`loan_approval`/`pr_review`/`research_debate`) and a payload, produced once a `ConsultationSession` is approved. |
| `ConsultationSession` / `ConsultationTurn` | The back-and-forth between a user and a consultant persona *before* any `Case`/`Debate` exists, used to pin down exactly what's being asked. Runs for every case, every time, self-determining a fast one-shot confirm vs. a fuller negotiation. |
| `AgentPersona` | Any LLM-backed role in the system — participant, consultant, or judge — distinguished by a `role` field. Each has a name, system prompt, and model config. |
| `Debate` | One run of a case through the debate lifecycle: `OPEN → ARGUING → CONVERGING → JUDGED` (or `NO_CONSENSUS` / `FAILED`). Has a `turn_strategy` (sequential/parallel/judge-directed) and a `judge_persona_id`. |
| `DebateParticipant` | Links an `AgentPersona` to a `Debate`, with a frozen `persona_snapshot` of that persona's config at the moment the debate started. |
| `ResearchFinding` | A single agent's independently-researched source (query, URL, summary) from the preparation round before arguing begins. |
| `Argument` | One agent's turn — free-text `content`, a structured `position` (plain string; valid values vary by case/debate, not a schema enum), a `responds_to` link (rebuttal chain), and a `cites_research_finding` link. |
| `ConvergenceCheck` | An audit record of one "is this debate settled" check, with the actual computed `signals` (not just a label). |
| `Verdict` | The judge's structured decision, confidence, reasoning, and `cited_arguments` — produced once, at `JUDGED`. |
| `HumanReview` | The human's actual real-world decision on a debate — `final_decision` (button-selected, never typed) plus a required `comment`. Kept entirely separate from `Verdict`; never overwrites it. |
| `CaseTypeConfig` | Per-case-type configuration: `position_options`, `decision_options`, `research_guardrail_prompt` — the single generic mechanism that drives UI rendering and validation without per-case-type code branches. |
| `Notification` | A persisted, per-user record of any event worth surfacing (debate lifecycle, failures, auth events) — delivered live via Redis pub/sub if the user's connected, but never lost if they aren't. |

## 6. User flow (all case types share this shape)

1. **Consultation.** User describes what they want debated. A consultant persona has a conversation with them — one quick confirmation pass if the request is already clear, or a fuller back-and-forth if it's ambiguous (this applies universally, not just to `research_debate` — a loan note or a PR request can be just as ambiguous as an open research question). User approves a final, specific question. **Approval is final — no revision after.**
2. **Case & Debate created.** The approved consultation produces a `Case`, then a `Debate` with a chosen `turn_strategy`.
3. **Preparation round.** Each participating agent independently researches the topic (real web search, per-case-type guardrails on what it can search for), storing citable `ResearchFinding`s. Streamed live: source list appears, then each source shown being processed.
4. **Opening statement.** The judge persona frames the debate — restates the case, introduces participants, states what "resolved" looks like.
5. **Arguing.** Agents take turns per the chosen strategy. Each `Argument` carries a structured position + confidence, cites a specific prior argument if its position changed (dissent-preserving — prevents groupthink from looking like genuine consensus), and can cite research findings. Streamed token-by-token live.
6. **Convergence check, each round.** Position stability + confidence-spread shrinkage + no-uncited-changes. Hits `max_rounds` without settling → `NO_CONSENSUS`, honestly labeled with lower confidence — this is a separate, already-solved problem from "converged too fast for the wrong reason" (which the citation requirement addresses).
7. **Judged.** One final judge call produces `Verdict` (decision, confidence, cited arguments) and a `closing_summary`, regardless of whether it converged or hit `NO_CONSENSUS`.
8. **Human review — always, no exceptions.** No verdict is ever auto-executed, regardless of confidence. A human records `final_decision` (button-selected from `CaseTypeConfig`) and a required `comment`.

## 7. Functional requirements

### 7.1 Consultation
- Every case, every case type, goes through a `ConsultationSession` before a `Case` exists.
- Consultant self-determines depth: one-shot confirm if clear, multi-turn negotiation if not.
- Approval is final; no revising an approved question.

### 7.2 Turn-taking
- Three configurable strategies per debate: sequential, parallel (with `blind` or `shared_after_round` visibility), judge-directed.
- Judge-directed routing uses cheap heuristics (unspoken this round, rebutted-but-unanswered, widest dissent from mean, round-robin fallback) — never an LLM call per turn, so all three strategies stay cost-comparable.

### 7.3 Convergence & dissent
- Signals: position stability, confidence-spread shrinkage, no new rebuttals, and — critically — no uncited position changes.
- A position change without a citation to the specific argument that caused it is a visible red flag, not silently counted as agreement.
- Hard `max_rounds` ceiling always wins; produces `NO_CONSENSUS` with honestly lower confidence rather than pretending convergence.
- Known accepted limitation: free-text positions (`research_debate`) can misfire the equality check on rewording alone; bounded by the human-review backstop, not fixed in v1.

### 7.4 Research round
- Each participating agent researches independently (not shared), using real web search.
- Per-case-type prompt guardrail (`CaseTypeConfig.research_guardrail_prompt`) restricts what agents search for — e.g. never an applicant's identifying details for `loan_approval`.
- Findings are stored (`ResearchFinding`) and citable from `Argument`.

### 7.5 Judge
- Exactly two guaranteed LLM calls per debate: opening statement, closing verdict + summary. No LLM calls during arguing rounds.
- `Verdict.cited_arguments` is a forced structured-output requirement, not free narration.

### 7.6 Human review
- Every debate requires human review before any real-world action, regardless of confidence or convergence.
- `final_decision` is button-selected from `CaseTypeConfig.decision_options` (never typed); `comment` is required, always.

### 7.7 Real-time streaming & notifications
- Argument tokens and research progress stream live over per-debate Redis channels (`debate:{id}:stream`), relayed through a FastAPI WebSocket.
- General notifications (auth events, failures, debate lifecycle) push live via a shared Redis channel (`app_notifications`) with per-user in-memory routing at the FastAPI layer, and are always persisted (`Notification`) so nothing is lost if the user wasn't connected when it happened.
- WebSocket connections require the same JWT as REST calls (carried via subprotocol, not query string) plus an explicit per-debate ownership check — authentication alone is not authorization.

### 7.8 Authentication
- Open self-registration — no invite or admin approval required to create an account.
- No email verification for v1 — a deliberate scope call, not an oversight: core project functionality takes priority, this is second-priority hardening for later.
- Access token in memory, refresh token in an HttpOnly/Secure/SameSite=Strict cookie, refresh-token rotation, 5–15 min access-token lifetime.
- Django (`simplejwt`) issues; FastAPI verifies independently via a shared signing key.

## 8. System architecture (summary — see `002` decisions 1–3, 9 for full reasoning)

- **Django** — auth, CRUD, admin, historical/read data. Owns all schema/migrations.
- **FastAPI** — the orchestration front door: starts Temporal workflows, hosts all WebSocket connections, relays Redis pub/sub events. Reads/writes the same Postgres tables via `sqlacodegen`-generated SQLAlchemy Core tables (CI-diffed against Django's schema to catch drift), never runs migrations.
- **Temporal (self-hosted)** — the durable outer loop: the debate lifecycle state machine, round logic, convergence checks. Deterministic; all LLM calls, DB writes, and search calls live in Activities.
- **LangGraph + LangChain** — the inner layer: per-turn agent reasoning as a small `StateGraph` inside each Activity. Not relied on for durability (Temporal owns that).
- **Redis** — pub/sub only, no numbered databases: per-debate streaming channels, one shared general-notification channel.
- **Angular** — frontend; structured logging shipped to the backend, not stored client-side.
- **OpenTelemetry** — one consistent observability system across Django, FastAPI, and Temporal; local rotating files today, swappable to an enterprise backend later with no code changes.

## 9. Deferred for core-first sequencing (tracked backlog, not permanent)

These exist because the priority right now is getting the core system running end to end — not because the underlying principle is rejected. Each is real work still owed, tracked here so it doesn't get forgotten once the core is up. See [docs/principles/](./principles/) for the standards these gaps are measured against, and check here before treating any of them as a new finding during an audit.

- Open self-registration with no email verification — anyone can register with an unverified/unowned email address.
- Research query safety is a prompt-level guardrail, not a hard technical block against agents seeing/searching identifying case data.
- No cost/rate-limiting controls on LLM or search spend.
- Convergence detection can misjudge free-text position changes as real when they're just rewording (`research_debate` case type) — a fix was scoped (consultant-negotiated candidate answers, `references/002` decision 5) but set aside for v1; bounded in the meantime by mandatory human review, not fixed.

## 9a. Permanent design trade-offs (by design — not backlog, not expected to change)

Different from the above: these aren't unfinished, they're the actual chosen architecture.

- Redis general-notification delivery is best-effort/live-only *by design* — the persisted `Notification` record is the real durability guarantee, live push is just the instant-nudge layer on top (decision 17).
- Temporal Workflow Streams was evaluated and deliberately rejected in favor of Redis, specifically for maturity since this is public-facing (decision 12) — a settled choice, not a gap to revisit later.

## 10. Open items — not yet written down (tracked, not blocking this PRD)

- Full deployment/docker-compose service list and required secrets enumeration.
- Remaining frontend screens/pages not yet built: case submission, consultant chat, human review screen, notification inbox, debate history. (Login/register and the live-debate-thread view are done — specs 0001/0006 — but still on mock orchestration data; see `docs/FLOWS.md`.)
- Cost controls (decision 19, explicitly deferred).
- Testing strategy specifics, Angular state-management choice, persona-management UI vs. Django-admin-only.
