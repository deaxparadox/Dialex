from django.urls import path

from .views import DebateArgumentsView, DebateDetailView, DebateListView

urlpatterns = [
    path("", DebateListView.as_view(), name="debate-list"),
    path("<int:pk>/", DebateDetailView.as_view(), name="debate-detail"),
    path("<int:debate_id>/arguments/", DebateArgumentsView.as_view(), name="debate-arguments"),
]
