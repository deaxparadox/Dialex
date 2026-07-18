from django.contrib import admin

from .models import Case, CaseTypeConfig


@admin.register(CaseTypeConfig)
class CaseTypeConfigAdmin(admin.ModelAdmin):
    list_display = ("type", "default_consultant_persona", "default_judge_persona", "default_max_rounds")
    filter_horizontal = ("default_participant_personas",)


@admin.register(Case)
class CaseAdmin(admin.ModelAdmin):
    list_display = ("id", "type", "status", "created_by", "created_at")
    list_filter = ("type", "status")
