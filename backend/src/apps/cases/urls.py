from django.urls import path

from .views import CaseDetailView, CaseListView

urlpatterns = [
    path("", CaseListView.as_view(), name="case-list"),
    path("<int:pk>/", CaseDetailView.as_view(), name="case-detail"),
]
