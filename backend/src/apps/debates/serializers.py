from rest_framework import serializers

from .models import AgentPersona, Argument, Debate, Verdict


class AgentPersonaMiniSerializer(serializers.ModelSerializer):
    """No `system_prompt`/`model_config` exposed to non-admin clients
    (docs/API.md's existing rule — those are prompts/model settings, not
    display copy). `role_description` is a plain descriptive label (e.g.
    "Favors the simplest thing that works") and is safe/useful to show,
    unlike the bare `role` enum (participant/consultant/judge), which
    doesn't distinguish one participant from another (spec 0008)."""

    class Meta:
        model = AgentPersona
        fields = ("id", "name", "role", "role_description")


class ArgumentSerializer(serializers.ModelSerializer):
    agent_persona = AgentPersonaMiniSerializer(read_only=True)
    leaning = serializers.SerializerMethodField()

    class Meta:
        model = Argument
        fields = (
            "id",
            "round_number",
            "agent_persona",
            "content",
            "position",
            "confidence",
            "responds_to_id",
            "cites_research_finding_id",
            "leaning",
            "created_at",
        )

    def get_leaning(self, obj) -> float:
        """0=most divergent, 1=most convergent (spec 0008). Primary source:
        index within CaseTypeConfig.position_options, which doubles as the
        spectrum itself (list order, not just a set of valid values — see
        that model's help_text). Falls back to clustering by distinct
        `position` value in first-seen order among this debate's own
        arguments when `position` isn't in the configured list (or there is
        no configured list at all, e.g. research_debate's free text)."""
        options = self.context.get("position_options") or []
        if obj.position in options and len(options) > 1:
            return options.index(obj.position) / (len(options) - 1)

        distinct_positions = self.context.get("distinct_positions") or []
        if obj.position in distinct_positions and len(distinct_positions) > 1:
            return distinct_positions.index(obj.position) / (len(distinct_positions) - 1)

        return 0.5


class VerdictSerializer(serializers.ModelSerializer):
    cited_arguments = serializers.PrimaryKeyRelatedField(many=True, read_only=True)

    class Meta:
        model = Verdict
        fields = ("id", "decision", "confidence", "reasoning", "cited_arguments", "created_at")


class DebateSerializer(serializers.ModelSerializer):
    judge_persona = AgentPersonaMiniSerializer(read_only=True)
    verdict = VerdictSerializer(read_only=True)

    class Meta:
        model = Debate
        fields = (
            "id",
            "case_id",
            "turn_strategy",
            "status",
            "current_round",
            "max_rounds",
            "opening_statement",
            "closing_summary",
            "judge_persona",
            "verdict",
            "created_at",
            "judged_at",
        )
