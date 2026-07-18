"""Verifies JWTs Django issued, independently — no callback to Django per
request (decision 13). Both sides use PyJWT/HS256 under the hood
(djangorestframework-simplejwt included), so this is genuinely the same
implementation on both ends, not just a compatible one (ADR 0003)."""

import jwt
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import settings

_bearer = HTTPBearer()


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Security(_bearer),
) -> int:
    try:
        payload = jwt.decode(credentials.credentials, settings.jwt_signing_key, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        ) from exc

    if payload.get("token_type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not an access token")

    user_id = payload.get("user_id")
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing user_id")

    return int(user_id)
