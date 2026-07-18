from django.contrib import admin

from .models import (
    AgentPersona,
    Argument,
    ConvergenceCheck,
    Debate,
    DebateParticipant,
    ResearchFinding,
    Verdict,
)


@admin.register(AgentPersona)
class AgentPersonaAdmin(admin.ModelAdmin):
    list_display = ("name", "role")
    list_filter = ("role",)


class DebateParticipantInline(admin.TabularInline):
    model = DebateParticipant
    extra = 0


@admin.register(Debate)
class DebateAdmin(admin.ModelAdmin):
    list_display = ("id", "case", "turn_strategy", "status", "current_round", "max_rounds")
    list_filter = ("status", "turn_strategy")
    inlines = [DebateParticipantInline]


@admin.register(Argument)
class ArgumentAdmin(admin.ModelAdmin):
    list_display = ("id", "debate", "round_number", "agent_persona", "position", "confidence")
    list_filter = ("position",)


@admin.register(ConvergenceCheck)
class ConvergenceCheckAdmin(admin.ModelAdmin):
    list_display = ("id", "debate", "round_number", "method", "result", "score")


@admin.register(Verdict)
class VerdictAdmin(admin.ModelAdmin):
    list_display = ("id", "debate", "decision", "confidence")


@admin.register(ResearchFinding)
class ResearchFindingAdmin(admin.ModelAdmin):
    list_display = ("id", "debate", "agent_persona", "source_title")
