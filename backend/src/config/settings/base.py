"""
Base Django settings — shared across every environment.
Environment-specific overrides live in development.py / production.py.

Config comes from environment variables (django-environ), per ADR 0002.
Anything required has no default here — missing it raises
django.core.exceptions.ImproperlyConfigured at startup, not a silent
fallback. See CLAUDE.md's "no silent fallback" rule.
"""

from datetime import timedelta
from pathlib import Path

import environ
from corsheaders.defaults import default_headers

# src/config/settings/base.py -> parents: settings, config, src
BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
environ.Env.read_env(BASE_DIR.parent / ".env")  # backend/.env

# --- Required, no default: fails loudly at import time if missing ---
SECRET_KEY = env("DJANGO_SECRET_KEY")
DATABASES = {"default": env.db("DATABASE_URL")}
SIMPLE_JWT_SIGNING_KEY = env("SIMPLE_JWT_SIGNING_KEY")

# --- Behavioral knobs with a safe default (fine per CLAUDE.md rule 5) ---
DEBUG = env.bool("DJANGO_DEBUG", default=False)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=[])

AUTH_USER_MODEL = "accounts.User"

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "apps.accounts",
    "apps.cases",
    "apps.debates",
    "apps.consultations",
    "apps.reviews",
    "apps.notifications",
]

MIDDLEWARE = [
    # As high as possible, per django-cors-headers' own docs — before any
    # middleware that can generate a response, so CORS headers land on
    # every response including error ones.
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
}

SIMPLE_JWT = {
    # 10 min — within the 5-15 min range locked in decision 13.
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=10),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "SIGNING_KEY": SIMPLE_JWT_SIGNING_KEY,
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

REFRESH_COOKIE_NAME = "refresh_token"
REFRESH_COOKIE_PATH = "/api/auth/refresh/"

# Matches Angular's built-in HttpClient XSRF defaults (ADR 0001) so the
# frontend needs no special CSRF configuration when it starts calling these
# endpoints.
CSRF_COOKIE_NAME = "XSRF-TOKEN"
CSRF_HEADER_NAME = "HTTP_X_XSRF_TOKEN"

# CsrfViewMiddleware's Origin check is separate from — and unaffected by —
# CORS_ALLOWED_ORIGINS above (CORS and CSRF are independent protections in
# Django); caught via real browser verification as a 403 "Origin checking
# failed" on every logout/refresh call, distinct from the CORS preflight
# issue CORS_ALLOW_HEADERS fixed. Scheme is required (bare hostnames aren't
# valid here, unlike CORS_ALLOWED_ORIGINS).
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=["http://localhost:4200"])

# spec 0006 — the Angular dev server (localhost:4200) and Django
# (localhost:8000) are different origins. Narrow allow-list, not a
# wildcard (CORS_ALLOW_ALL_ORIGINS is incompatible with credentials
# anyway) — extend this list, don't loosen it, if more dev origins show up.
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=["http://localhost:4200"])
CORS_ALLOW_CREDENTIALS = True

# django-cors-headers' own default allow-list includes "x-csrftoken" (Django's
# *default* CSRF header name) but not "x-xsrf-token" — the name this project
# deliberately renamed CSRF_HEADER_NAME to, to match Angular's own defaults
# (see above). Without this, the browser's CORS preflight rejects the header
# before Django ever sees the request — caught via real browser verification
# (a preflight failure, not visible in curl/Postman-style testing).
CORS_ALLOW_HEADERS = [*default_headers, "x-xsrf-token"]
