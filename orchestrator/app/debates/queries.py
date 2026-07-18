"""SQLAlchemy Core helpers against `generated_tables.py` (decision 9) — the
generated file is never hand-edited; all query logic that touches it lives
here instead, imported by activities.py. Reads use `engine.connect()`,
writes use `engine.begin()` for an implicit commit/rollback transaction."""

from datetime import date, datetime, timezone

from sqlalchemy import insert, select, update

from ..core.db import engine
from ..core.generated_tables import (
    t_cases_case,
    t_cases_casetypeconfig,
    t_debates_agentpersona,
    t_debates_argument,
    t_debates_convergencecheck,
    t_debates_debate,
    t_debates_debateparticipant,
    t_debates_verdict,
    t_debates_verdict_cited_arguments,
)


def _serialize(row: dict) -> dict:
    """Temporal's default data converter round-trips activity results
    through JSON — datetime columns (created_at/judged_at/approved_at)
    need to be plain strings before crossing that boundary."""
    return {
        key: value.isoformat() if isinstance(value, (datetime, date)) else value
        for key, value in row.items()
    }


async def get_debate(debate_id: int) -> dict | None:
    async with engine.connect() as conn:
        row = (
            await conn.execute(select(t_debates_debate).where(t_debates_debate.c.id == debate_id))
        ).mappings().first()
        return _serialize(dict(row)) if row else None


async def get_case(case_id: int) -> dict:
    async with engine.connect() as conn:
        row = (
            await conn.execute(select(t_cases_case).where(t_cases_case.c.id == case_id))
        ).mappings().first()
        return _serialize(dict(row))


async def get_case_type_config(case_type: str) -> dict | None:
    async with engine.connect() as conn:
        row = (
            await conn.execute(
                select(t_cases_casetypeconfig).where(t_cases_casetypeconfig.c.type == case_type)
            )
        ).mappings().first()
        return _serialize(dict(row)) if row else None


async def get_judge_persona(judge_persona_id: int) -> dict:
    async with engine.connect() as conn:
        row = (
            await conn.execute(
                select(t_debates_agentpersona).where(t_debates_agentpersona.c.id == judge_persona_id)
            )
        ).mappings().first()
        return _serialize(dict(row))


async def get_participants(debate_id: int) -> list[dict]:
    """Ordered by id — the fixed persona order the sequential turn strategy
    uses (decision 2's "sequential" means a deterministic order, not a
    fresh choice every round)."""
    async with engine.connect() as conn:
        rows = (
            await conn.execute(
                select(t_debates_debateparticipant)
                .where(t_debates_debateparticipant.c.debate_id == debate_id)
                .order_by(t_debates_debateparticipant.c.id)
            )
        ).mappings().all()
        return [_serialize(dict(row)) for row in rows]


async def get_arguments(debate_id: int, up_to_round: int | None = None) -> list[dict]:
    query = select(t_debates_argument).where(t_debates_argument.c.debate_id == debate_id)
    if up_to_round is not None:
        query = query.where(t_debates_argument.c.round_number <= up_to_round)
    query = query.order_by(t_debates_argument.c.round_number, t_debates_argument.c.id)
    async with engine.connect() as conn:
        rows = (await conn.execute(query)).mappings().all()
        return [_serialize(dict(row)) for row in rows]


async def insert_argument(
    debate_id: int,
    agent_persona_id: int,
    round_number: int,
    content: str,
    position: str | None,
    confidence: float | None,
    responds_to_id: int | None,
) -> int:
    async with engine.begin() as conn:
        result = await conn.execute(
            insert(t_debates_argument).values(
                debate_id=debate_id,
                agent_persona_id=agent_persona_id,
                round_number=round_number,
                content=content,
                position=position,
                confidence=confidence,
                responds_to_id=responds_to_id,
                created_at=datetime.now(timezone.utc),
            )
        )
        return result.inserted_primary_key[0]


async def insert_convergence_check(
    debate_id: int, round_number: int, signals: dict, result: bool, score: float
) -> int:
    async with engine.begin() as conn:
        db_result = await conn.execute(
            insert(t_debates_convergencecheck).values(
                debate_id=debate_id,
                round_number=round_number,
                method="structured_signals",
                signals=signals,
                result=result,
                score=score,
                created_at=datetime.now(timezone.utc),
            )
        )
        return db_result.inserted_primary_key[0]


async def set_debate_status(debate_id: int, status: str) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            update(t_debates_debate).where(t_debates_debate.c.id == debate_id).values(status=status)
        )


async def set_debate_round(debate_id: int, current_round: int) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            update(t_debates_debate)
            .where(t_debates_debate.c.id == debate_id)
            .values(current_round=current_round)
        )


async def set_debate_opening_statement(debate_id: int, opening_statement: str) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            update(t_debates_debate)
            .where(t_debates_debate.c.id == debate_id)
            .values(opening_statement=opening_statement)
        )


async def close_debate(
    debate_id: int, status: str, closing_summary: str
) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            update(t_debates_debate)
            .where(t_debates_debate.c.id == debate_id)
            .values(status=status, closing_summary=closing_summary, judged_at=datetime.now(timezone.utc))
        )


async def insert_verdict(
    debate_id: int, decision: str, confidence: float, reasoning: str, cited_argument_ids: list[int]
) -> int:
    async with engine.begin() as conn:
        result = await conn.execute(
            insert(t_debates_verdict).values(
                debate_id=debate_id,
                decision=decision,
                confidence=confidence,
                reasoning=reasoning,
                created_at=datetime.now(timezone.utc),
            )
        )
        verdict_id = result.inserted_primary_key[0]
        if cited_argument_ids:
            await conn.execute(
                insert(t_debates_verdict_cited_arguments),
                [{"verdict_id": verdict_id, "argument_id": aid} for aid in cited_argument_ids],
            )
        return verdict_id
