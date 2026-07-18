"""OpenTelemetry setup for the orchestrator — decision 16, spec 0005.
Shared by both processes (the FastAPI API and the Temporal worker), since
both need the same trace/log correlation.

Traces export to console and structured logs to a local rotating file
today; swapping to a real backend later is an exporter change here only.

`debate_id`/`session_id`/`user_id` are attached explicitly via
`bind_debate_context` at the top of every Activity (each one already
receives `debate_id` as a parameter) and in the start endpoint — a
Workflow and its Activities don't share memory, so nothing propagates
these implicitly the way trace_id/span_id do via the Temporal OTel
interceptor.
"""

import contextvars
import logging
import logging.handlers
from pathlib import Path

from opentelemetry import trace
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

_debate_id_var = contextvars.ContextVar("dialex_debate_id", default=None)
_session_id_var = contextvars.ContextVar("dialex_session_id", default=None)
_user_id_var = contextvars.ContextVar("dialex_user_id", default=None)

_LOG_FORMAT = (
    "%(asctime)s %(levelname)s %(name)s "
    "trace_id=%(trace_id)s span_id=%(span_id)s "
    "debate_id=%(debate_id)s session_id=%(session_id)s user_id=%(user_id)s "
    "%(message)s"
)


class _DialexContextFilter(logging.Filter):
    """trace_id/span_id read directly from the OTel API (see backend's
    observability.py for why this isn't delegated to
    opentelemetry-instrumentation-logging), plus the ambient
    debate/session/user identifiers set via `bind_debate_context`."""

    def filter(self, record):
        span_context = trace.get_current_span().get_span_context()
        if span_context.is_valid:
            record.trace_id = format(span_context.trace_id, "032x")
            record.span_id = format(span_context.span_id, "016x")
        else:
            record.trace_id = None
            record.span_id = None
        record.debate_id = _debate_id_var.get()
        record.session_id = _session_id_var.get()
        record.user_id = _user_id_var.get()
        return True


def bind_debate_context(debate_id=None, session_id=None, user_id=None):
    span = trace.get_current_span()
    if debate_id is not None:
        span.set_attribute("dialex.debate_id", debate_id)
        _debate_id_var.set(debate_id)
    if session_id is not None:
        span.set_attribute("dialex.session_id", session_id)
        _session_id_var.set(session_id)
    if user_id is not None:
        span.set_attribute("dialex.user_id", user_id)
        _user_id_var.set(user_id)


def setup_observability(service_name, log_file_path, engine=None):
    """Call once, at process start (both `main.py` and `worker.py`).
    `engine` is optional — the worker process doesn't need SQLAlchemy
    instrumented if it never queries directly (it does, via queries.py,
    so both processes actually pass it)."""
    resource = Resource.create({"service.name": service_name})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    trace.set_tracer_provider(provider)

    formatter = logging.Formatter(_LOG_FORMAT)
    context_filter = _DialexContextFilter()

    log_file_path = Path(log_file_path)
    log_file_path.parent.mkdir(parents=True, exist_ok=True)
    file_handler = logging.handlers.RotatingFileHandler(
        log_file_path, maxBytes=10 * 1024 * 1024, backupCount=5
    )
    file_handler.setFormatter(formatter)
    file_handler.addFilter(context_filter)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.addFilter(context_filter)

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)

    if engine is not None:
        SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine)
