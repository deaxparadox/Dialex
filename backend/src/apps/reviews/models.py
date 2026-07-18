from django.conf import settings
from django.db import models


class HumanReview(models.Model):
    """The human's actual real-world decision on a debate (references/002
    decision 8) — kept entirely separate from Verdict, never overwrites it.
    Every debate requires one before anything real happens, regardless of
    confidence or convergence."""

    debate = models.OneToOneField(
        "debates.Debate", on_delete=models.CASCADE, related_name="human_review"
    )
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    comment = models.TextField()
    final_decision = models.CharField(
        max_length=255,
        null=True,
        blank=True,
        help_text="Button-selected from CaseTypeConfig.decision_options, never typed; "
        "null when that list is empty (research_debate).",
    )
    reviewed_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Review of Debate #{self.debate_id} by {self.reviewer}"
