from django.contrib.auth.models import AbstractUser


class User(AbstractUser):
    """Custom user model, introduced before the first migration —
    per ADR 0002, Django can't safely swap this in later."""
