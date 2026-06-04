"""Generic mirror tests.

`/api/cp/<path>` forwards anything not in the typed registry. The mirror
proves forward compatibility - new NCR endpoints are reachable before
cp_endpoints.ENDPOINTS catches up.
"""
from __future__ import annotations


def test_mirror_forwards_unknown_path(client):
    """An unknown subpath should still reach CP; CP's response (likely
    404) is passed through unchanged. A 502 from the wrapper would mean
    transport failure - that's what we're guarding against."""
    r = client.get("/api/cp/__cntrport_smoke_unknown__")
    assert r.status_code != 0, "wrapper couldn't reach CP at all"
    assert r.status_code != 502, (
        f"wrapper reported transport error on mirror: {r.text[:300]}"
    )


def test_mirror_preserves_query_string(client):
    """Query strings should be forwarded. We can't easily inspect what CP
    received, but the wrapper should not crash and should not strip the
    query into a 500."""
    r = client.get("/api/cp/__cntrport_smoke__", params={"a": "1", "b": "two"})
    assert r.status_code < 500 or r.status_code == 502, (
        f"unexpected 5xx other than 502: {r.status_code} {r.text[:200]}"
    )
