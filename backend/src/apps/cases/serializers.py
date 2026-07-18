from rest_framework import serializers

from .models import Case, CaseTypeConfig


class CaseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Case
        fields = ("id", "type", "payload", "status", "created_at")


class CaseTypeConfigSerializer(serializers.ModelSerializer):
    """Just `type` — shared config for a case-type picker (spec 0010), not
    the persona/round internals (those stay admin-only, no client needs
    them)."""

    class Meta:
        model = CaseTypeConfig
        fields = ("type",)
