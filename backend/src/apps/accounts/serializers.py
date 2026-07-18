import uuid

from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import User


class SessionTaggingTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Mints a `session_id` claim on the refresh token at login, so every
    service that already decodes the JWT (Django, the orchestrator) can
    correlate logs/traces to a login session — this system has no
    server-side Django session to reuse otherwise (decision 13 is stateless
    JWT). Survives refresh rotation for free: simplejwt's rotation mutates
    the same token's jti/exp/iat in place rather than re-minting from
    scratch, so a claim set here persists automatically."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["session_id"] = str(uuid.uuid4())
        return token


class RegisterSerializer(serializers.ModelSerializer):
    """Open self-registration, no email verification (decision 13, PRD §9 —
    deliberate deferral, not an oversight). Django's standard password
    validators only, no custom rules (ADR 0002)."""

    password = serializers.CharField(write_only=True, validators=[validate_password])

    class Meta:
        model = User
        fields = ("id", "username", "email", "password")

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)
