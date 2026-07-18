from rest_framework import generics

from .models import Case, CaseTypeConfig
from .serializers import CaseSerializer, CaseTypeConfigSerializer


class CaseListView(generics.ListAPIView):
    """Scoped to the requesting user's own cases (spec 0008) — filtering in
    `get_queryset` rather than checking ownership after the fact avoids the
    IDOR shape already caught once in the orchestrator (spec 0005)."""

    serializer_class = CaseSerializer

    def get_queryset(self):
        return Case.objects.filter(created_by=self.request.user).order_by("-created_at")


class CaseDetailView(generics.RetrieveAPIView):
    serializer_class = CaseSerializer

    def get_queryset(self):
        return Case.objects.filter(created_by=self.request.user)


class CaseTypeConfigListView(generics.ListAPIView):
    """Not ownership-scoped — shared config, not user data (same reasoning
    as `/api/personas/`'s existing plan, spec 0010)."""

    serializer_class = CaseTypeConfigSerializer
    queryset = CaseTypeConfig.objects.all().order_by("type")
