from rest_framework import serializers

from .models import Case


class CaseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Case
        fields = ("id", "type", "payload", "status", "created_at")
