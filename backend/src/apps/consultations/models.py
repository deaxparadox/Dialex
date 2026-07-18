from django.conf import settings
from django.db import models


class ConsultationSession(models.Model):
    """The back-and-forth between a user and a consultant persona *before*
    any Case/Debate exists (references/002 decision 10). Approval is final —
    no revising an approved session.

    `user` isn't in the original design notes verbatim but is a necessary
    addition (spec 0002): a session obviously belongs to whoever is having
    the conversation.
    """

    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        AWAITING_APPROVAL = "AWAITING_APPROVAL", "Awaiting approval"
        APPROVED = "APPROVED", "Approved"
        FAILED = "FAILED", "Failed"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="consultation_sessions"
    )
    case_type = models.CharField(max_length=100)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    consultant_persona = models.ForeignKey(
        "debates.AgentPersona",
        on_delete=models.PROTECT,
        limit_choices_to={"role": "consultant"},
    )
    finalized_payload = models.JSONField(
        null=True, blank=True, help_text="Set only once the user approves; becomes the Case's content."
    )
    created_at = models.DateTimeField(auto_now_add=True)
    approved_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"ConsultationSession #{self.pk} ({self.status})"


class ConsultationTurn(models.Model):
    """The consultant/user back-and-forth log — same event-log shape as
    Argument."""

    class Speaker(models.TextChoices):
        USER = "user", "User"
        CONSULTANT = "consultant", "Consultant"

    session = models.ForeignKey(ConsultationSession, on_delete=models.CASCADE, related_name="turns")
    turn_number = models.PositiveIntegerField()
    speaker = models.CharField(max_length=20, choices=Speaker.choices)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("session", "turn_number")
        ordering = ["turn_number"]

    def __str__(self):
        return f"Turn {self.turn_number} ({self.speaker}) in session #{self.session_id}"
