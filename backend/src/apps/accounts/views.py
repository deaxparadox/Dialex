import logging

from django.conf import settings
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework import generics, permissions, status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from config.observability import bind_debate_context

from .serializers import RegisterSerializer, SessionTaggingTokenObtainPairSerializer

logger = logging.getLogger(__name__)


def _set_refresh_cookie(response, refresh_token):
    lifetime = settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"]
    response.set_cookie(
        settings.REFRESH_COOKIE_NAME,
        str(refresh_token),
        max_age=int(lifetime.total_seconds()),
        httponly=True,
        secure=not settings.DEBUG,
        samesite="Strict",
        path=settings.REFRESH_COOKIE_PATH,
    )


class RegisterView(generics.CreateAPIView):
    """Open self-registration, no invite/approval needed (decision 13)."""

    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]


class LoginView(TokenObtainPairView):
    """Access token in the body; refresh token moved to an HttpOnly cookie,
    never present in JSON (decision 13)."""

    serializer_class = SessionTaggingTokenObtainPairSerializer

    def finalize_response(self, request, response, *args, **kwargs):
        if response.status_code == 200 and "refresh" in response.data:
            refresh = response.data.pop("refresh")
            _set_refresh_cookie(response, refresh)
        if response.status_code == 200 and "access" in response.data:
            payload = AccessToken(response.data["access"]).payload
            bind_debate_context(session_id=payload.get("session_id"), user_id=payload.get("user_id"))
            logger.info("user logged in")
        return super().finalize_response(request, response, *args, **kwargs)


@method_decorator(csrf_protect, name="dispatch")
class RefreshView(TokenRefreshView):
    """Reads the refresh token from the cookie, not the request body — the
    frontend never sees or sends it directly. Rotates the cookie on every
    use (decision 13). DRF's APIView exempts views from Django's CSRF
    middleware by default, and JWTAuthentication doesn't reinstate it the
    way SessionAuthentication does — csrf_protect explicitly closes that
    gap here, since a cookie-carried refresh token is real CSRF surface."""

    def post(self, request, *args, **kwargs):
        refresh_token = request.COOKIES.get(settings.REFRESH_COOKIE_NAME)
        if not refresh_token:
            raise AuthenticationFailed("Refresh token missing.")

        serializer = self.get_serializer(data={"refresh": refresh_token})
        try:
            serializer.is_valid(raise_exception=True)
        except TokenError as exc:
            raise AuthenticationFailed(str(exc)) from exc

        data = dict(serializer.validated_data)
        new_refresh = data.pop("refresh", None)
        response = Response(data, status=status.HTTP_200_OK)
        if new_refresh:
            _set_refresh_cookie(response, new_refresh)
        payload = AccessToken(data["access"]).payload
        bind_debate_context(session_id=payload.get("session_id"), user_id=payload.get("user_id"))
        logger.info("access token refreshed")
        return response


@method_decorator(csrf_protect, name="dispatch")
class LogoutView(APIView):
    """Blacklists the refresh token read from the cookie and clears it."""

    def post(self, request, *args, **kwargs):
        refresh_token = request.COOKIES.get(settings.REFRESH_COOKIE_NAME)
        if refresh_token:
            try:
                token = RefreshToken(refresh_token)
                bind_debate_context(
                    session_id=token.payload.get("session_id"), user_id=token.payload.get("user_id")
                )
                token.blacklist()
                logger.info("user logged out")
            except TokenError:
                pass  # already invalid/expired — logging out is still a success either way

        response = Response(status=status.HTTP_204_NO_CONTENT)
        response.delete_cookie(settings.REFRESH_COOKIE_NAME, path=settings.REFRESH_COOKIE_PATH)
        return response


class CsrfBootstrapView(APIView):
    """GET this once on app load so Django sets the XSRF-TOKEN cookie
    (ADR 0001) before the frontend needs to send it back on refresh/logout."""

    permission_classes = [permissions.AllowAny]

    def get(self, request, *args, **kwargs):
        get_token(request)  # ensures the cookie is set on the response
        return Response(status=status.HTTP_204_NO_CONTENT)
