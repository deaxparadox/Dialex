from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.response import Response

from apps.debates.models import Debate

from .serializers import HumanReviewSerializer


class HumanReviewCreateView(generics.CreateAPIView):
    """`POST /api/debates/{debate_id}/review/` — ownership-checked against
    the debate's owning Case (same 404-not-500 IDOR pattern every other
    debate view uses), 409 on a duplicate review. The model's own
    `OneToOneField` on `debate` already enforces one-review-per-debate at
    the DB level (spec 0032 Phase 3) — this view's only job is surfacing
    that as a clean 409, not a raw IntegrityError 500."""

    serializer_class = HumanReviewSerializer

    def create(self, request, *args, **kwargs):
        debate = get_object_or_404(Debate, pk=self.kwargs["debate_id"], case__created_by=request.user)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            serializer.save(debate=debate, reviewer=request.user)
        except IntegrityError:
            return Response(
                {"detail": "This debate has already been reviewed."}, status=status.HTTP_409_CONFLICT
            )
        return Response(serializer.data, status=status.HTTP_201_CREATED)
