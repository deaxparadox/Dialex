from django.urls import path

from apps.reviews.views import HumanReviewCreateView

from .views import DebateArgumentsView, DebateDetailView, DebateListView

urlpatterns = [
    path("", DebateListView.as_view(), name="debate-list"),
    path("<int:pk>/", DebateDetailView.as_view(), name="debate-detail"),
    path("<int:debate_id>/arguments/", DebateArgumentsView.as_view(), name="debate-arguments"),
    # Kept in the debates app's URL module since it's debate-scoped
    # (matching arguments/'s placement), even though the model lives in
    # apps.reviews — the URL structure follows the resource acted on.
    path("<int:debate_id>/review/", HumanReviewCreateView.as_view(), name="debate-review"),
]
