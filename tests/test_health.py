"""Health endpoint smoke tests."""
from __future__ import annotations


def test_health_returns_200(client):
    r = client.get("/api/health")
    assert r.status_code == 200


def test_health_has_expected_shape(client):
    data = client.get("/api/health").json()
    for field in ("ok", "company_alias", "sql", "counterpoint_api"):
        assert field in data, f"/api/health missing {field}"
    assert "ok" in data["sql"]
    assert "ok" in data["counterpoint_api"]
    assert "base_url" in data["counterpoint_api"]


def test_counterpoint_api_reachable(client):
    """A 401 from CP still flips cp.ok=true — the server answered. Only
    transport errors (timeout, DNS, refused) flip it false. If this fails,
    check CP_API_BASE_URL and that the Counterpoint API service is up."""
    cp = client.get("/api/health").json()["counterpoint_api"]
    assert cp["ok"] is True, f"CP unreachable: {cp.get('error')}"


def test_sql_reachable_or_clearly_off(client):
    """SQL is optional. If sql.ok is false, the failure should at least be
    explained (an error message), not silently missing."""
    sql = client.get("/api/health").json()["sql"]
    if not sql["ok"]:
        assert sql.get("error"), "sql.ok=false but no error message"
