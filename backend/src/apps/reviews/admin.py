from django.contrib import admin

from .models import HumanReview


@admin.register(HumanReview)
class HumanReviewAdmin(admin.ModelAdmin):
    list_display = ("id", "debate", "reviewer", "final_decision", "reviewed_at")
