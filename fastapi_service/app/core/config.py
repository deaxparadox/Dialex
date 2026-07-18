"""Fail-fast settings — mirrors django-environ's approach on the Django side
(ADR 0002/0003). Required fields have no default: pydantic-settings raises
a validation error at import time if any is missing, not a silent fallback.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    jwt_signing_key: str  # same value as Django's SIMPLE_JWT_SIGNING_KEY (decision 13)


settings = Settings()
