from django.db import models


class AgentPersona(models.Model):
    """Any LLM-backed role — participant, consultant, or judge — distinguished
    by `role` (references/002 decision 10). One table, not three, so every
    role is swappable/reusable the same way."""

    class Role(models.TextChoices):
        PARTICIPANT = "participant", "Participant"
        CONSULTANT = "consultant", "Consultant"
        JUDGE = "judge", "Judge"

    name = models.CharField(max_length=255)
    role = models.CharField(max_length=20, choices=Role.choices)
    role_description = models.TextField(blank=True)
    system_prompt = models.TextField()
    model_config = models.JSONField(help_text="Which LLM, temperature, etc.")

    def __str__(self):
        return f"{self.name} ({self.role})"


class Debate(models.Model):
    """One run of a case through the debate lifecycle
    (OPEN -> ARGUING -> CONVERGING -> JUDGED, or NO_CONSENSUS / FAILED)."""

    class TurnStrategy(models.TextChoices):
        SEQUENTIAL = "sequential", "Sequential"
        PARALLEL = "parallel", "Parallel"
        JUDGE_DIRECTED = "judge_directed", "Judge-directed"

    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        ARGUING = "ARGUING", "Arguing"
        CONVERGING = "CONVERGING", "Converging"
        JUDGED = "JUDGED", "Judged"
        NO_CONSENSUS = "NO_CONSENSUS", "No consensus"
        FAILED = "FAILED", "Failed"

    case = models.ForeignKey("cases.Case", on_delete=models.CASCADE, related_name="debates")
    turn_strategy = models.CharField(max_length=20, choices=TurnStrategy.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    current_round = models.PositiveIntegerField(default=0)
    max_rounds = models.PositiveIntegerField()
    convergence_config = models.JSONField(default=dict, blank=True)
    judge_persona = models.ForeignKey(
        AgentPersona,
        on_delete=models.PROTECT,
        related_name="judged_debates",
        limit_choices_to={"role": AgentPersona.Role.JUDGE},
    )
    opening_statement = models.TextField(null=True, blank=True)
    closing_summary = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    judged_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Debate #{self.pk} ({self.status})"


class DebateParticipant(models.Model):
    """Links an AgentPersona to a Debate, with a frozen `persona_snapshot`
    (references/002 decision 7) so old debates stay explainable even if the
    live AgentPersona row changes later."""

    debate = models.ForeignKey(Debate, on_delete=models.CASCADE, related_name="participants")
    agent_persona = models.ForeignKey(AgentPersona, on_delete=models.PROTECT)
    stance_seed = models.TextField(null=True, blank=True)
    persona_snapshot = models.JSONField(
        help_text="Frozen copy of the persona's config at the moment the debate started."
    )

    class Meta:
        unique_together = ("debate", "agent_persona")

    def __str__(self):
        return f"{self.agent_persona} in Debate #{self.debate_id}"


class ResearchFinding(models.Model):
    """One agent's independently-researched source from the preparation
    round (references/002 decision 11)."""

    debate = models.ForeignKey(Debate, on_delete=models.CASCADE, related_name="research_findings")
    agent_persona = models.ForeignKey(AgentPersona, on_delete=models.PROTECT)
    query = models.TextField()
    source_url = models.TextField(null=True, blank=True)
    source_title = models.TextField(null=True, blank=True)
    summary = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Finding by {self.agent_persona} in Debate #{self.debate_id}"


class Argument(models.Model):
    """One agent's turn — the append-only event log. `position` is a plain
    string (references/002 decision 5), not a schema enum: validity varies
    per case type/debate, not per this table.

    `responds_to` doubles as the citation-on-position-change link (decision
    4): when `position` differs from this agent's own prior-round position,
    `responds_to` must point at the argument that changed its mind. That
    conditional rule is enforced at the application/serializer layer, not a
    DB constraint, since it only applies when a change actually happened.
    """

    debate = models.ForeignKey(Debate, on_delete=models.CASCADE, related_name="arguments")
    round_number = models.PositiveIntegerField()
    agent_persona = models.ForeignKey(AgentPersona, on_delete=models.PROTECT)
    content = models.TextField()
    responds_to = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="responses"
    )
    position = models.CharField(max_length=255, null=True, blank=True)
    confidence = models.FloatField(null=True, blank=True)
    cites_research_finding = models.ForeignKey(
        ResearchFinding, on_delete=models.SET_NULL, null=True, blank=True
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.agent_persona} round {self.round_number} in Debate #{self.debate_id}"


class ConvergenceCheck(models.Model):
    """Audit trail of one 'is this debate settled' check — `signals` holds
    the actual computed values (references/002 decision 6), not just a
    label, so 'why did the debate stop' has a real answer."""

    debate = models.ForeignKey(Debate, on_delete=models.CASCADE, related_name="convergence_checks")
    round_number = models.PositiveIntegerField()
    method = models.CharField(
        max_length=50,
        default="structured_signals",
        help_text="Single accurate label for the check actually implemented.",
    )
    signals = models.JSONField(
        help_text="position_stable, confidence_spread, uncited_changes, etc."
    )
    result = models.BooleanField()
    score = models.FloatField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"ConvergenceCheck round {self.round_number} for Debate #{self.debate_id}"


class Verdict(models.Model):
    """The judge's structured decision — produced once, at JUDGED.
    `cited_arguments` is a forced-citation M2M (references/002 decision 8),
    not free narration."""

    debate = models.OneToOneField(Debate, on_delete=models.CASCADE, related_name="verdict")
    decision = models.CharField(max_length=255)
    confidence = models.FloatField()
    reasoning = models.TextField()
    cited_arguments = models.ManyToManyField(Argument, related_name="cited_in_verdicts")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Verdict for Debate #{self.debate_id}: {self.decision}"
