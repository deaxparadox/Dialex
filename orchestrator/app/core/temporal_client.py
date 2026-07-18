"""Shared Temporal Client factory — used by both the API process (to start
workflows) and the worker process. Registering `TracingInterceptor` here
(rather than only on the Worker) is what makes the trace started by a
`POST /debates/{id}/start` call continue into the Workflow and every
Activity automatically (verified against Temporal's own docs, ADR 0004)."""

from temporalio.client import Client
from temporalio.contrib.opentelemetry import TracingInterceptor

from .config import settings

TASK_QUEUE = "dialex-debates"


async def get_temporal_client() -> Client:
    return await Client.connect(
        settings.temporal_address,
        interceptors=[TracingInterceptor()],
    )
