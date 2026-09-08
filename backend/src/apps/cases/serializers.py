from rest_framework import serializers

from .models import Case, CaseTypeConfig


class CaseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Case
        fields = ("id", "type", "payload", "status", "created_at")


class CaseTypeConfigSerializer(serializers.ModelSerializer):
    """`type` for the case-type picker (spec 0010); `decision_options` added
    (spec 0039) since the Human Review panel needs it client-side to decide
    buttons-vs-comment-only. persona/round internals stay admin-only, no
    client needs them."""

    class Meta:
        model = CaseTypeConfig
        fields = ("type", "decision_options")
