"""`/api/cp` manifest tests - describes what the wrapper exposes."""
from __future__ import annotations


def test_manifest_ok(client):
    r = client.get("/api/cp")
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert "registry" in data
    assert "registry_count" in data
    assert data["registry_count"] == len(data["registry"])
    assert data["registry_count"] > 0, "registry is empty - cp_endpoints.ENDPOINTS not loaded?"


def test_manifest_lists_known_endpoints(client):
    """Sanity: a handful of well-known CP paths should always be in the
    registry."""
    paths = {row["guide_path"] for row in client.get("/api/cp").json()["registry"]}
    for expected in ("/Company", "/SystemInfo", "/Databases"):
        assert expected in paths, f"{expected} missing from registry"


def test_registry_entry_shape(client):
    sample = client.get("/api/cp").json()["registry"][0]
    for field in (
        "method", "guide_path", "name", "description",
        "requires_api_key", "requires_cp_registration", "wrapper_paths",
        "has_pre_hooks", "has_during_hook", "has_post_hooks",
    ):
        assert field in sample, f"registry entry missing {field}"
    assert isinstance(sample["wrapper_paths"], list)
    assert len(sample["wrapper_paths"]) == 2  # /api/cp/<path> and /<path>


def test_manifest_includes_direct_mode_block(client):
    data = client.get("/api/cp").json()
    assert "direct_mode" in data
    for field in ("enabled", "opt_in_query", "opt_in_header", "description"):
        assert field in data["direct_mode"]


def test_manifest_includes_sql_extensions(client):
    data = client.get("/api/cp").json()
    assert "sql_extensions" in data
    assert isinstance(data["sql_extensions"], list)
    assert "/api/sql/items" in data["sql_extensions"]
