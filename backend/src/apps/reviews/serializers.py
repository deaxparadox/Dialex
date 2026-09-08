from rest_framework import serializers

from .models import HumanReview


class HumanReviewSerializer(serializers.ModelSerializer):
    """`reviewer`/`reviewed_at` read-only — set server-side (perform_create),
    never client-supplied."""

    class Meta:
        model = HumanReview
        fields = ("id", "final_decision", "comment", "reviewer", "reviewed_at")
        read_only_fields = ("id", "reviewer", "reviewed_at")
