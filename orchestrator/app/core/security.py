"""Verifies JWTs Django issued, independently — no callback to Django per
request (decision 13). Both sides use PyJWT/HS256 under the hood
(djangorestframework-simplejwt included), so this is genuinely the same
implementation on both ends, not just a compatible one (ADR 0003)."""

from dataclasses import dataclass

import jwt
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import settings

_bearer = HTTPBearer()


@dataclass
class AuthContext:
    user_id: int
    session_id: str | None  # None for tokens issued before spec 0005's session_id claim existed


def decode_access_token(token: str | None) -> AuthContext | None:
    """Shared by both auth paths — HTTP (`get_auth_context`, raises) and
    WebSocket (spec 0013, returns `None` on failure instead: a WebSocket
    has no HTTP response to attach a 401 to, so the caller closes the
    connection itself rather than this function raising an HTTPException
    that would make no sense on a socket)."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_signing_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None

    if payload.get("token_type") != "access":
        return None
    user_id = payload.get("user_id")
    if user_id is None:
        return None
    return AuthContext(user_id=int(user_id), session_id=payload.get("session_id"))


def get_auth_context(
    credentials: HTTPAuthorizationCredentials = Security(_bearer),
) -> AuthContext:
    auth = decode_access_token(credentials.credentials)
    if auth is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    return auth
