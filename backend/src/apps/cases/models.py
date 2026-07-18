from django.conf import settings
from django.db import models


class CaseTypeConfig(models.Model):
    """The single generic mechanism driving per-case-type vocab and prompts
    (references/002 decision 5c) — one shared config instead of hardcoded
    per-case-type branches anywhere in schema or UI."""

    type = models.CharField(max_length=100, unique=True)
    position_options = models.JSONField(
        default=list,
        blank=True,
        help_text=(
            'e.g. ["reject", "uncertain", "approve"]. List ORDER matters (spec 0008): '
            "it doubles as the divergence→convergence spectrum the debate-thread "
            "visualization plots arguments along — seed it most-divergent-first, "
            "most-convergent-last, not just as an unordered set of valid values."
        ),
    )
    decision_options = models.JSONField(
        default=list, blank=True, help_text='e.g. ["approve", "deny"], or [] for research_debate'
    )
    research_guardrail_prompt = models.TextField(
        blank=True,
        help_text="Appended to the research Activity's system prompt for this case type (decision 14).",
    )

    def __str__(self):
        return self.type


class Case(models.Model):
    """A submission to be debated — produced once a ConsultationSession is
    approved (references/002 decision 10)."""

    type = models.CharField(max_length=100)
    payload = models.JSONField()
    status = models.CharField(max_length=50, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="cases"
    )
    consultation_session = models.OneToOneField(
        "consultations.ConsultationSession",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="resulting_case",
        help_text="Traceability back to the consultation that produced this case (decision 10).",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Case #{self.pk} ({self.type})"
