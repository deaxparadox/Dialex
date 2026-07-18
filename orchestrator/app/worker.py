"""Temporal worker entrypoint — polls `dialex-debates` for `DebateWorkflow`
and its Activities. A separate process from the API (uvicorn): a Temporal
Worker is a long-running polling loop, a fundamentally different lifecycle
from request/response serving (ADR 0004)."""

import asyncio
from pathlib import Path

from temporalio.contrib.langgraph import LangGraphPlugin
from temporalio.worker import Worker

from .core.db import engine
from .core.observability import setup_observability
from .core.temporal_client import TASK_QUEUE, get_temporal_client
from .debates.activities import ALL_ACTIVITIES
from .debates.graphs import (
    ARGUMENT_GRAPH,
    JUDGE_CLOSING_GRAPH,
    JUDGE_OPENING_GRAPH,
    build_argument_graph,
    build_judge_closing_graph,
    build_judge_opening_graph,
)
from .debates.workflows import DebateWorkflow


async def main():
    setup_observability(
        "dialex-orchestrator-worker",
        Path(__file__).resolve().parent.parent / "logs" / "worker.log",
        engine=engine,
    )
    client = await get_temporal_client()
    plugin = LangGraphPlugin(
        graphs={
            ARGUMENT_GRAPH: build_argument_graph(),
            JUDGE_OPENING_GRAPH: build_judge_opening_graph(),
            JUDGE_CLOSING_GRAPH: build_judge_closing_graph(),
        }
    )
    worker = Worker(
        client,
        task_queue=TASK_QUEUE,
        workflows=[DebateWorkflow],
        activities=ALL_ACTIVITIES,
        plugins=[plugin],
    )
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
