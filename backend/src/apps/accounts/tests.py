from django.conf import settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from .models import User


class AuthFlowTests(APITestCase):
    """Covers decisions 13/13a (spec 0003): cookie-based refresh, CSRF
    enforcement on refresh/logout, blacklist-after-rotation.

    `enforce_csrf_checks=True` on the client is required here — it's a
    Client *constructor* argument, not a per-request kwarg, so this has to
    be set once, not passed to individual .post() calls.
    """

    client_class = APIClient

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.user = User.objects.create_user(username="alice", password="a-Reasonably-Str0ng-pw!")

    def _get_csrf_token(self):
        self.client.get(reverse("auth-csrf"))
        return self.client.cookies[settings.CSRF_COOKIE_NAME].value

    def test_register_creates_user(self):
        response = self.client.post(
            reverse("auth-register"),
            {"username": "bob", "email": "bob@dialex.local", "password": "another-Str0ng-pw!"},
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(User.objects.filter(username="bob").exists())
        self.assertNotIn("password", response.data)

    def test_register_rejects_weak_password(self):
        response = self.client.post(
            reverse("auth-register"),
            {"username": "carol", "email": "carol@dialex.local", "password": "password"},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_login_returns_access_and_sets_httponly_refresh_cookie(self):
        response = self.client.post(
            reverse("auth-login"), {"username": "alice", "password": "a-Reasonably-Str0ng-pw!"}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        self.assertNotIn("refresh", response.data)

        cookie = response.cookies[settings.REFRESH_COOKIE_NAME]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["samesite"], "Strict")
        self.assertEqual(cookie["path"], settings.REFRESH_COOKIE_PATH)

    def test_refresh_without_csrf_header_is_blocked(self):
        self.client.post(
            reverse("auth-login"), {"username": "alice", "password": "a-Reasonably-Str0ng-pw!"}
        )
        # No X-XSRF-TOKEN header sent — with enforce_csrf_checks=True this
        # must be rejected, proving csrf_protect is actually doing something
        # rather than DRF's default view-level CSRF exemption silently winning.
        response = self.client.post(reverse("auth-refresh"))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_refresh_rotates_cookie_and_returns_new_access(self):
        csrf_token = self._get_csrf_token()
        self.client.post(
            reverse("auth-login"), {"username": "alice", "password": "a-Reasonably-Str0ng-pw!"}
        )
        old_refresh = self.client.cookies[settings.REFRESH_COOKIE_NAME].value

        response = self.client.post(reverse("auth-refresh"), HTTP_X_XSRF_TOKEN=csrf_token)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        new_refresh = response.cookies[settings.REFRESH_COOKIE_NAME].value
        self.assertNotEqual(old_refresh, new_refresh)

    def test_refresh_missing_cookie_returns_401(self):
        csrf_token = self._get_csrf_token()
        response = self.client.post(reverse("auth-refresh"), HTTP_X_XSRF_TOKEN=csrf_token)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_blacklists_refresh_token(self):
        csrf_token = self._get_csrf_token()
        self.client.post(
            reverse("auth-login"), {"username": "alice", "password": "a-Reasonably-Str0ng-pw!"}
        )

        logout_response = self.client.post(reverse("auth-logout"), HTTP_X_XSRF_TOKEN=csrf_token)
        self.assertEqual(logout_response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(self.client.cookies[settings.REFRESH_COOKIE_NAME].value, "")

        # Re-using the (client-side deleted, but previously-issued) refresh
        # token directly against the endpoint should fail since it's blacklisted.
        refresh_response = self.client.post(reverse("auth-refresh"), HTTP_X_XSRF_TOKEN=csrf_token)
        self.assertEqual(refresh_response.status_code, status.HTTP_401_UNAUTHORIZED)
