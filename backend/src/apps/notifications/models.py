from django.conf import settings
from django.db import models


class Notification(models.Model):
    """A persisted, per-user record of any event worth surfacing
    (references/002 decision 17) — delivered live via Redis pub/sub if the
    user's connected, but never lost if they aren't. This table is the real
    durability guarantee; live push is just the instant-nudge layer on top."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    type = models.CharField(max_length=100)
    message = models.TextField()
    related_case = models.ForeignKey(
        "cases.Case", on_delete=models.CASCADE, null=True, blank=True, related_name="notifications"
    )
    related_debate = models.ForeignKey(
        "debates.Debate", on_delete=models.CASCADE, null=True, blank=True, related_name="notifications"
    )
    read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Notification({self.type}) for {self.user}"
