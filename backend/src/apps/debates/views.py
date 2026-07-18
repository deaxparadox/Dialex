from functools import cached_property

from rest_framework import generics
from rest_framework.exceptions import NotFound

from apps.cases.models import CaseTypeConfig

from .models import Argument, Debate
from .serializers import ArgumentSerializer, DebateSerializer


class DebateListView(generics.ListAPIView):
    """Scoped to the requesting user's own debates (spec 0008) — via the
    owning Case, filtered in `get_queryset` rather than checked after the
    fact (the IDOR shape already caught once in the orchestrator, spec
    0005)."""

    serializer_class = DebateSerializer

    def get_queryset(self):
        queryset = Debate.objects.filter(case__created_by=self.request.user)
        case_id = self.request.query_params.get("case")
        if case_id is not None:
            queryset = queryset.filter(case_id=case_id)
        return queryset.order_by("-created_at")


class DebateDetailView(generics.RetrieveAPIView):
    serializer_class = DebateSerializer

    def get_queryset(self):
        return Debate.objects.filter(case__created_by=self.request.user)


class DebateArgumentsView(generics.ListAPIView):
    """Full argument DAG for one debate, ordered by round then insertion —
    this is the "read before opening the live stream" catch-up endpoint
    docs/API.md describes (decision 12's WebSocket isn't built yet, so for
    now this is the only view)."""

    serializer_class = ArgumentSerializer

    @cached_property
    def debate(self) -> Debate:
        try:
            return Debate.objects.select_related("case").get(
                pk=self.kwargs["debate_id"], case__created_by=self.request.user
            )
        except Debate.DoesNotExist as exc:
            raise NotFound("Debate not found") from exc

    def get_queryset(self):
        return Argument.objects.filter(debate=self.debate).order_by("round_number", "id")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        config = CaseTypeConfig.objects.filter(type=self.debate.case.type).first()
        context["position_options"] = config.position_options if config else []

        seen = []
        for position in self.get_queryset().values_list("position", flat=True):
            if position is not None and position not in seen:
                seen.append(position)
        context["distinct_positions"] = seen
        return context
