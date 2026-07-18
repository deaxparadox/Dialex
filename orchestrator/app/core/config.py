"""Fail-fast settings — mirrors django-environ's approach on the Django side
(ADR 0002/0003). Required fields have no default: pydantic-settings raises
a validation error at import time if any is missing, not a silent fallback.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    jwt_signing_key: str  # same value as Django's SIMPLE_JWT_SIGNING_KEY (decision 13)
    # min_length=1 — an empty string otherwise satisfies `str` and passes
    # silently, which defeats the whole point of a required field (caught
    # during spec 0005 verification: booted fine with a blank key, then
    # failed deep inside an Activity instead of at startup).
    openai_api_key: str = Field(min_length=1)  # spec 0005 — LLM calls, never silently skipped
    temporal_address: str = Field(min_length=1)  # e.g. temporal:7233 inside compose


settings = Settings()
