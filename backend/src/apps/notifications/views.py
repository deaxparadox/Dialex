from rest_framework import generics

from .models import Notification
from .serializers import NotificationSerializer


class NotificationListView(generics.ListAPIView):
    """Ownership-scoped (spec 0040) — same pattern every other list view
    uses. Ordering already comes from Notification.Meta.ordering."""

    serializer_class = NotificationSerializer

    def get_queryset(self):
        return Notification.objects.filter(user=self.request.user)


class NotificationUpdateView(generics.UpdateAPIView):
    """PATCH-only (mark read) — no full replace needed for a single boolean
    flip. Ownership-scoped via get_queryset so a non-owned notification
    404s, not a 403 that would leak its existence."""

    serializer_class = NotificationSerializer
    http_method_names = ["patch"]

    def get_queryset(self):
        return Notification.objects.filter(user=self.request.user)
