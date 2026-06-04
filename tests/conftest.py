"""
Pytest fixtures for CntrPort wrapper integration tests.

These tests hit a *running* Flask wrapper (default http://localhost:5000)
and forward to the configured Counterpoint API. They are read-only —
GETs only, never POST/PUT/PATCH/DELETE — so they are safe to run against
a real install (e.g. BishopsCellar) without touching data.

Configuration (env vars, also picked up from .env):
    TEST_BASE_URL         Wrapper base URL. Default http://localhost:5000.
    TEST_API_KEY          Wrapper key sent in the auth header. Falls back
                          to CNTRPORT_API_KEY from .env if unset.
    TEST_API_KEY_HEADER   Header name. Falls back to CNTRPORT_API_KEY_HEADER
                          (.env), else X-API-Key.

If the wrapper isn't reachable on TEST_BASE_URL, the whole session aborts
with a clear message rather than firing 50 confusing failures.
"""
from __future__ import annotations

import os
from typing import Any

import pytest
import requests
from dotenv import load_dotenv

load_dotenv()

TEST_BASE_URL = os.getenv("TEST_BASE_URL", "http://localhost:5000").rstrip("/")
TEST_API_KEY = os.getenv("TEST_API_KEY", os.getenv("CNTRPORT_API_KEY", ""))
TEST_API_KEY_HEADER = os.getenv(
    "TEST_API_KEY_HEADER",
    os.getenv("CNTRPORT_API_KEY_HEADER", "X-API-Key"),
)


class Client:
    """Thin requests.Session wrapper that knows the wrapper base URL and
    injects the wrapper API key header on every call.

    Use `client.get(path)` for normal (authenticated) requests and
    `client.raw_get(path)` when you want to test the auth gate itself.
    """

    def __init__(self, base_url: str, api_key: str, key_header: str):
        self.base_url = base_url
        self.api_key = api_key
        self.key_header = key_header
        self.session = requests.Session()

    def _merge_headers(self, extra: dict[str, str] | None) -> dict[str, str]:
        hdrs: dict[str, str] = {}
        if self.api_key:
            hdrs[self.key_header] = self.api_key
        if extra:
            hdrs.update(extra)
        return hdrs

    def get(self, path: str, *, headers: dict[str, str] | None = None, **kw: Any):
        return self.session.get(
            self.base_url + path,
            headers=self._merge_headers(headers),
            timeout=15,
            **kw,
        )

    def raw_get(self, path: str, *, headers: dict[str, str] | None = None, **kw: Any):
        """GET without the wrapper API key injected. For auth-gate tests."""
        return self.session.get(
            self.base_url + path,
            headers=headers or {},
            timeout=15,
            **kw,
        )


@pytest.fixture(scope="session")
def client() -> Client:
    return Client(TEST_BASE_URL, TEST_API_KEY, TEST_API_KEY_HEADER)


@pytest.fixture(scope="session")
def config() -> dict[str, Any]:
    return {
        "base_url": TEST_BASE_URL,
        "api_key": TEST_API_KEY,
        "key_header": TEST_API_KEY_HEADER,
        "auth_enabled": bool(TEST_API_KEY),
    }


def pytest_sessionstart(session: pytest.Session) -> None:
    """Bail out fast if the wrapper isn't listening. Avoids a wall of
    confusing connection errors."""
    try:
        r = requests.get(TEST_BASE_URL + "/api/health", timeout=5)
    except requests.RequestException as exc:
        pytest.exit(
            f"Wrapper not reachable at {TEST_BASE_URL}: {exc}\n"
            f"Is Flask running on the VM? (`py app.py`)",
            returncode=2,
        )
    if r.status_code >= 500:
        pytest.exit(
            f"Wrapper at {TEST_BASE_URL} returned {r.status_code} on /api/health.\n"
            f"Body: {r.text[:300]}",
            returncode=2,
        )
