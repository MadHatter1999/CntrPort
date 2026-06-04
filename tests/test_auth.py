"""Wrapper API-key gate tests.

When CNTRPORT_API_KEY is set in .env, every non-exempt path needs the key
in CNTRPORT_API_KEY_HEADER (default X-API-Key). When it's blank, the gate
is a no-op. These tests cover both modes.
"""
from __future__ import annotations

import pytest


def test_health_is_exempt(client):
    """Uptime probes must work without the key. /api/health is exempt by
    default via CNTRPORT_AUTH_EXEMPT_PATHS."""
    r = client.raw_get("/api/health")
    assert r.status_code == 200


def test_missing_key_rejected(client, config):
    if not config["auth_enabled"]:
        pytest.skip("CNTRPORT_API_KEY not set; wrapper auth disabled")
    r = client.raw_get("/api/cp")
    assert r.status_code == 401
    body = r.json()
    assert body.get("ok") is False
    assert config["key_header"] in body.get("message", "")


def test_wrong_key_rejected(client, config):
    if not config["auth_enabled"]:
        pytest.skip("CNTRPORT_API_KEY not set; wrapper auth disabled")
    r = client.raw_get(
        "/api/cp",
        headers={config["key_header"]: "definitely-not-the-key"},
    )
    assert r.status_code == 401


def test_correct_key_accepted(client, config):
    if not config["auth_enabled"]:
        pytest.skip("CNTRPORT_API_KEY not set; wrapper auth disabled")
    r = client.get("/api/cp")
    assert r.status_code == 200


def test_key_is_not_forwarded_upstream(client, config):
    """The wrapper key is for the wrapper. It must not appear on the
    request sent to NCR. We can't see the upstream call directly, but the
    manifest tells us CP_API_KEY_HEADER (what NCR expects) - and the
    wrapper's CNTRPORT_API_KEY_HEADER should be different so there's no
    collision."""
    if not config["auth_enabled"]:
        pytest.skip("CNTRPORT_API_KEY not set; wrapper auth disabled")
    # Indirect check: the wrapper key header should not be the same as
    # NCR's APIKey header - otherwise a misconfiguration would let the
    # caller's key reach NCR.
    assert config["key_header"].lower() != "apikey", (
        "CNTRPORT_API_KEY_HEADER must not collide with CP_API_KEY_HEADER "
        "(default 'APIKey'). Change CNTRPORT_API_KEY_HEADER in .env."
    )


def test_auth_disabled_open_mode(client, config):
    """When CNTRPORT_API_KEY is blank, /api/cp answers any caller."""
    if config["auth_enabled"]:
        pytest.skip("Wrapper auth enabled; this test covers disabled mode")
    r = client.raw_get("/api/cp")
    assert r.status_code == 200
