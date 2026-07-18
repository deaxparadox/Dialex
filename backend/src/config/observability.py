"""OpenTelemetry setup for Django — decision 16, implemented for real per
spec 0005 (pulled into that milestone rather than done later, to avoid
retrofitting log/trace correlation into the orchestrator's activities
after the fact).

Traces export to console and structured logs to a local rotating file
today; decision 16's whole point is that swapping to a real backend later
is an exporter change here only, no call-site changes anywhere else.

`debate_id`/`session_id`/`user_id` are attached explicitly via
`bind_debate_context` — OpenTelemetry has no idea they're
business-meaningful on its own, so nothing propagates them implicitly the
way trace_id/span_id do.
"""

import contextvars
import logging
import logging.handlers
from pathlib import Path

from opentelemetry import trace
from opentelemetry.instrumentation.django import DjangoInstrumentor
from opentelemetry.instrumentation.psycopg import PsycopgInstrumentor
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
    """Injects trace_id/span_id (read straight from the OTel API — not
    delegated to opentelemetry-instrumentation-logging, whose record
    mutation turned out to require `set_logging_format=True` to actually
    populate `otelTraceID`/`otelSpanID`, which conflicted with using our own
    formatter) plus the ambient debate/session/user identifiers (set via
    `bind_debate_context`) into every log record, so call sites never have
    to pass any of this explicitly on every log call."""

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
    """Attach identifiers to the current span and to every subsequent log
    record in this execution context. Called explicitly wherever a
    debate/session becomes known (a request, a Temporal Activity) rather
    than relying on any automatic propagation — Temporal Activities in
    particular don't share memory with the Workflow that scheduled them."""
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


def setup_observability(service_name, log_file_path):
    """Call once, at process start, before serving any requests."""
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

    DjangoInstrumentor().instrument()
    PsycopgInstrumentor().instrument()
