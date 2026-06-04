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
from pathlib import Path
from typing import Any

import pytest
import requests
from dotenv import load_dotenv

# Load .env from the project root (parent of tests/), not pytest's cwd.
# Without this, running `pytest tests/` from a different directory would
# silently get an empty CNTRPORT_API_KEY and every gated test would 401.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

TEST_BASE_URL = os.getenv("TEST_BASE_URL", "http://localhost:5000").rstrip("/")
TEST_API_KEY = os.getenv("TEST_API_KEY", os.getenv("CNTRPORT_API_KEY", "")).strip()
TEST_API_KEY_HEADER = os.getenv(
    "TEST_API_KEY_HEADER",
    os.getenv("CNTRPORT_API_KEY_HEADER", "X-API-Key"),
).strip()


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


def pytest_report_header(config: pytest.Config) -> list[str]:
    """Surface the loaded test config at the top of the pytest output so
    a missing key (the usual cause of mystery 401s) is obvious."""
    key_state = f"(set, {len(TEST_API_KEY)} chars)" if TEST_API_KEY else "(NOT SET — gated tests will skip or 401)"
    return [
        f"CntrPort wrapper base URL : {TEST_BASE_URL}",
        f"CntrPort auth header      : {TEST_API_KEY_HEADER}",
        f"CntrPort API key          : {key_state}",
        f"CntrPort .env loaded from : {_PROJECT_ROOT / '.env'}",
    ]


def pytest_sessionstart(session: pytest.Session) -> None:
    """Bail out fast if the wrapper isn't reachable OR if a configured key
    doesn't actually open the gate. Avoids a wall of confusing failures."""
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

    # If a key is configured for the tests, prove it opens the gate before
    # we run anything. A 401 here means the test process loaded a value
    # that doesn't match what Flask is using — the #1 cause of mass-401s.
    if TEST_API_KEY:
        gate = requests.get(
            TEST_BASE_URL + "/api/cp",
            headers={TEST_API_KEY_HEADER: TEST_API_KEY},
            timeout=5,
        )
        if gate.status_code == 401:
            pytest.exit(
                "\n".join([
                    "Wrapper rejected the configured wrapper API key.",
                    f"  Header sent : {TEST_API_KEY_HEADER}",
                    f"  Key length  : {len(TEST_API_KEY)} chars",
                    f"  Loaded from : {_PROJECT_ROOT / '.env'}",
                    "",
                    "Fix: confirm the same CNTRPORT_API_KEY value is in .env on",
                    "the VM, then restart Flask so it re-reads .env. The tests",
                    "and Flask must load the same value.",
                ]),
                returncode=2,
            )
    else:
        # No key configured at all but Flask might still be enforcing one.
        # Detect that mismatch up front too.
        probe = requests.get(TEST_BASE_URL + "/api/cp", timeout=5)
        if probe.status_code == 401:
            pytest.exit(
                "\n".join([
                    "Wrapper is enforcing a CNTRPORT_API_KEY but the test process",
                    "didn't load one. Either:",
                    f"  - set CNTRPORT_API_KEY (or TEST_API_KEY) in .env at {_PROJECT_ROOT}, or",
                    "  - unset CNTRPORT_API_KEY on the Flask side and restart it.",
                ]),
                returncode=2,
            )
