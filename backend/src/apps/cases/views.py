from rest_framework import generics

from .models import Case
from .serializers import CaseSerializer


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
