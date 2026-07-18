from django.contrib import admin

from .models import ConsultationSession, ConsultationTurn


class ConsultationTurnInline(admin.TabularInline):
    model = ConsultationTurn
    extra = 0


@admin.register(ConsultationSession)
class ConsultationSessionAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "case_type", "status", "created_at")
    list_filter = ("status", "case_type")
    inlines = [ConsultationTurnInline]
