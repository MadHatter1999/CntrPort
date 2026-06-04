"""Direct-mode tests. Auto-skipped when CP_ALLOW_DIRECT_MODE is false."""
from __future__ import annotations

import pytest


@pytest.fixture(scope="module")
def direct_or_skip(client):
    try:
        enabled = client.get("/api/cp").json()["direct_mode"]["enabled"] is True
    except Exception:
        enabled = False
    if not enabled:
        pytest.skip("CP_ALLOW_DIRECT_MODE not enabled")


def test_direct_query_param_marks_response(client, direct_or_skip):
    """?_direct=1 should bypass hooks and add the X-CntrP-Mode: direct
    response header. /Company is a low-impact GET present on most installs."""
    r = client.get("/Company", params={"_direct": "1"})
    assert r.status_code not in (0, 502)
    assert r.headers.get("X-CntrP-Mode") == "direct"


def test_direct_header_marks_response(client, direct_or_skip):
    r = client.get("/Company", headers={"X-CntrP-Mode": "direct"})
    assert r.status_code not in (0, 502)
    assert r.headers.get("X-CntrP-Mode") == "direct"


def test_normal_request_has_no_direct_header(client, direct_or_skip):
    """No opt-in -> normal hooked response, no X-CntrP-Mode header."""
    r = client.get("/Company")
    assert "X-CntrP-Mode" not in r.headers


def test_direct_query_flag_stripped_before_forwarding(client, direct_or_skip):
    """The wrapper strips `_direct` from the query before forwarding. We
    can't observe CP's view directly, but if it was forwarded CP would
    treat it as an unknown query param - harmless, but we at least verify
    the request still succeeds end-to-end."""
    r = client.get("/Company", params={"_direct": "1", "_smoke": "1"})
    assert r.status_code not in (0, 502)
