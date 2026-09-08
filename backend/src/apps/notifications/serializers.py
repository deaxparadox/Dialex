from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    """Only `read` is ever client-writable (via PATCH) — everything else is
    server-authored."""

    class Meta:
        model = Notification
        fields = ("id", "type", "message", "related_case", "related_debate", "read", "created_at")
        read_only_fields = ("id", "type", "message", "related_case", "related_debate", "created_at")
