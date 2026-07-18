"""SQLAlchemy Core helpers against `generated_tables.py` (decision 9) —
same shape as `debates/queries.py`: reads via `engine.connect()`, writes via
`engine.begin()`. Consultation approval also writes into `cases`/`debates`
tables directly (spec 0009), matching decision 9's "no callback to Django"
rule already used for every other orchestrator write."""

from datetime import date, datetime, timezone

from sqlalchemy import insert, select, update

from ..core.db import engine
from ..core.generated_tables import (
    t_cases_case,
    t_cases_casetypeconfig,
    t_cases_casetypeconfig_default_participant_personas,
    t_consultations_consultationsession,
    t_consultations_consultationturn,
    t_debates_agentpersona,
    t_debates_debate,
    t_debates_debateparticipant,
)


def _serialize(row: dict) -> dict:
    return {
        key: value.isoformat() if isinstance(value, (datetime, date)) else value
        for key, value in row.items()
    }


async def get_session(session_id: int) -> dict | None:
    async with engine.connect() as conn:
        row = (
            await conn.execute(
                select(t_consultations_consultationsession).where(
                    t_consultations_consultationsession.c.id == session_id
                )
            )
        ).mappings().first()
        return _serialize(dict(row)) if row else None


async def get_agent_persona(persona_id: int) -> dict:
    async with engine.connect() as conn:
        row = (
            await conn.execute(
                select(t_debates_agentpersona).where(t_debates_agentpersona.c.id == persona_id)
            )
        ).mappings().first()
        return _serialize(dict(row))


async def get_case_type_defaults(case_type: str) -> dict | None:
    """Returns the CaseTypeConfig row plus its participant persona ids —
    everything approval needs to auto-populate a Debate (spec 0009,
    ADR 0005 decision 5)."""
    async with engine.connect() as conn:
        config_row = (
            await conn.execute(
                select(t_cases_casetypeconfig).where(t_cases_casetypeconfig.c.type == case_type)
            )
        ).mappings().first()
        if config_row is None:
            return None
        participant_rows = (
            await conn.execute(
                select(t_cases_casetypeconfig_default_participant_personas.c.agentpersona_id).where(
                    t_cases_casetypeconfig_default_participant_personas.c.casetypeconfig_id
                    == config_row["id"]
                )
            )
        ).all()
        config = _serialize(dict(config_row))
        config["default_participant_persona_ids"] = [r[0] for r in participant_rows]
        return config


async def insert_session(user_id: int, case_type: str, consultant_persona_id: int) -> int:
    async with engine.begin() as conn:
        result = await conn.execute(
            insert(t_consultations_consultationsession).values(
                user_id=user_id,
                case_type=case_type,
                status="OPEN",
                consultant_persona_id=consultant_persona_id,
                created_at=datetime.now(timezone.utc),
            )
        )
        return result.inserted_primary_key[0]


async def get_turns(session_id: int) -> list[dict]:
    async with engine.connect() as conn:
        rows = (
            await conn.execute(
                select(t_consultations_consultationturn)
                .where(t_consultations_consultationturn.c.session_id == session_id)
                .order_by(t_consultations_consultationturn.c.turn_number)
            )
        ).mappings().all()
        return [_serialize(dict(row)) for row in rows]


async def insert_turn(session_id: int, turn_number: int, speaker: str, content: str) -> int:
    async with engine.begin() as conn:
        result = await conn.execute(
            insert(t_consultations_consultationturn).values(
                session_id=session_id,
                turn_number=turn_number,
                speaker=speaker,
                content=content,
                created_at=datetime.now(timezone.utc),
            )
        )
        return result.inserted_primary_key[0]


async def create_case_and_debate(
    session_id: int,
    user_id: int,
    case_type: str,
    finalized_payload: dict,
    judge_persona_id: int,
    max_rounds: int,
    participant_persona_ids: list[int],
) -> dict:
    """One transaction: Case, Debate, one DebateParticipant per persona
    (frozen persona_snapshot, decision 7), then marks the session APPROVED.
    Caller (the workflow's `create_case_and_debate` Activity) has already
    validated `participant_persona_ids` is non-empty — this function trusts
    that, per CLAUDE.md's boundary-validation rule."""
    async with engine.begin() as conn:
        case_result = await conn.execute(
            insert(t_cases_case).values(
                type=case_type,
                payload=finalized_payload,
                status="OPEN",
                created_by_id=user_id,
                consultation_session_id=session_id,
                created_at=datetime.now(timezone.utc),
            )
        )
        case_id = case_result.inserted_primary_key[0]

        debate_result = await conn.execute(
            insert(t_debates_debate).values(
                case_id=case_id,
                turn_strategy="sequential",
                status="OPEN",
                current_round=0,
                max_rounds=max_rounds,
                convergence_config={},
                judge_persona_id=judge_persona_id,
                created_at=datetime.now(timezone.utc),
            )
        )
        debate_id = debate_result.inserted_primary_key[0]

        for persona_id in participant_persona_ids:
            persona_row = (
                await conn.execute(
                    select(t_debates_agentpersona).where(t_debates_agentpersona.c.id == persona_id)
                )
            ).mappings().first()
            await conn.execute(
                insert(t_debates_debateparticipant).values(
                    debate_id=debate_id,
                    agent_persona_id=persona_id,
                    persona_snapshot={
                        "name": persona_row["name"],
                        "system_prompt": persona_row["system_prompt"],
                        "model_config": persona_row["model_config"],
                    },
                )
            )

        await conn.execute(
            update(t_consultations_consultationsession)
            .where(t_consultations_consultationsession.c.id == session_id)
            .values(
                status="APPROVED",
                finalized_payload=finalized_payload,
                approved_at=datetime.now(timezone.utc),
            )
        )

        return {"case_id": case_id, "debate_id": debate_id}


async def mark_session_failed(session_id: int) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            update(t_consultations_consultationsession)
            .where(t_consultations_consultationsession.c.id == session_id)
            .values(status="FAILED")
        )
