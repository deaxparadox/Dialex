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
    required_fields = models.JSONField(
        default=list,
        blank=True,
        help_text=(
            "List of {name, type, description} the consultant must collect before "
            "finalizing (ADR 0010) — enforced via a dynamically-built structured-output "
            "schema, not just prompt wording. Empty list (e.g. research_debate) keeps the "
            "intake fully free-form, unchanged from before this field existed."
        ),
    )
    policy_context = models.TextField(
        blank=True,
        help_text=(
            "Domain grounding text fed into the consultant and, once a debate starts, "
            "every participant's argument prompt and the judge's verdict prompt (ADR "
            "0010) — e.g. lending norms for loan_approval. Renamed from the unused "
            "research_guardrail_prompt, which was never wired to any code path."
        ),
    )
    default_consultant_persona = models.ForeignKey(
        "debates.AgentPersona",
        on_delete=models.PROTECT,
        related_name="+",
        limit_choices_to={"role": "consultant"},
        help_text=(
            "Required — every case type must have a consultant configured (decision 10: "
            "the consultant runs for every case, every time). No default/null: a case type "
            "missing this simply can't be saved (spec 0009)."
        ),
    )
    default_participant_personas = models.ManyToManyField(
        "debates.AgentPersona",
        related_name="+",
        limit_choices_to={"role": "participant"},
        blank=True,
        help_text=(
            "Frozen into DebateParticipant.persona_snapshot when a consultation is approved "
            "(spec 0009). Not enforced non-empty at the DB level — the approval activity "
            "checks and fails loudly instead of silently creating a zero-participant Debate."
        ),
    )
    default_judge_persona = models.ForeignKey(
        "debates.AgentPersona",
        on_delete=models.PROTECT,
        related_name="+",
        limit_choices_to={"role": "judge"},
        help_text="Required — same fail-fast reasoning as default_consultant_persona (spec 0009).",
    )
    default_max_rounds = models.PositiveIntegerField(
        default=3,
        help_text="Behavioral default for an auto-created Debate's max_rounds (spec 0009).",
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
