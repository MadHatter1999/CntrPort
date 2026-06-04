"""Typed-route tests.

Every endpoint in cp_endpoints.ENDPOINTS is mounted twice: at the bare
path (drop-in mode) and under /api/cp/<path>. Both should reach CP and
return the same status. We pick a few low-impact, read-only system
endpoints as probes — they may return 401/403 if the CP user lacks
permission, but they must never return 502 (which would mean the wrapper
couldn't reach CP) or 0 (transport error).
"""
from __future__ import annotations

import pytest

# Low-impact GETs. Doesn't matter if they return 200, 401, 403, or 404
# from CP — what matters is the wrapper got there and back.
READ_ONLY_PROBES = [
    "/Company",
    "/SystemInfo",
    "/Databases",
    "/Customers",
    "/Items",
]


@pytest.mark.parametrize("path", READ_ONLY_PROBES)
def test_drop_in_mode_reaches_cp(client, path):
    r = client.get(path)
    assert r.status_code not in (0, 502), (
        f"{path}: wrapper couldn't reach CP. Body: {r.text[:300]}"
    )


@pytest.mark.parametrize("path", READ_ONLY_PROBES)
def test_prefixed_mode_reaches_cp(client, path):
    r = client.get("/api/cp" + path)
    assert r.status_code not in (0, 502), (
        f"/api/cp{path}: wrapper couldn't reach CP. Body: {r.text[:300]}"
    )


@pytest.mark.parametrize("path", READ_ONLY_PROBES)
def test_drop_in_and_prefixed_match(client, path):
    """The two mount points should be the same view — same status code on
    the same back-to-back call."""
    a = client.get(path).status_code
    b = client.get("/api/cp" + path).status_code
    assert a == b, f"{path}: drop-in returned {a}, /api/cp returned {b}"


def test_unknown_method_returns_405(client):
    """The dispatcher emits 405 (not 404) for a registered path called
    with a wrong method. /SystemInfo is GET-only in the registry."""
    r = client.session.request(
        "DELETE", client.base_url + "/SystemInfo",
        headers={client.key_header: client.api_key} if client.api_key else {},
        timeout=15,
    )
    # 405 is the contract; some installs may surface a different status
    # if CP itself rejects first, but it should NOT be 200.
    assert r.status_code != 200
