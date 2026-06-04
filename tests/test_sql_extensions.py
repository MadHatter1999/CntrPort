"""SQL extension tests. Auto-skipped if SQL is not reachable per /api/health."""
from __future__ import annotations

import pytest


@pytest.fixture(scope="module")
def sql_or_skip(client):
    try:
        sql_ok = client.get("/api/health").json()["sql"]["ok"] is True
    except Exception:
        sql_ok = False
    if not sql_ok:
        pytest.skip("SQL not reachable per /api/health")


def test_categories_list(client, sql_or_skip):
    r = client.get("/api/sql/categories")
    assert r.status_code == 200
    data = r.json()
    assert "categories" in data
    assert isinstance(data["categories"], list)


def test_subcategories_list(client, sql_or_skip):
    r = client.get("/api/sql/subcategories")
    assert r.status_code == 200
    assert "subcategories" in r.json()


def test_items_search_respects_limit(client, sql_or_skip):
    r = client.get("/api/sql/items", params={"limit": 5})
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert isinstance(items, list)
    assert len(items) <= 5


def test_items_search_with_query(client, sql_or_skip):
    """Empty `q` returns recent items. Non-empty `q` filters. Either way,
    we just verify the shape - actual matches depend on the install."""
    r = client.get("/api/sql/items", params={"q": "", "limit": 3})
    assert r.status_code == 200
    for item in r.json().get("items", []):
        for field in ("item_no", "description", "category", "subcategory",
                      "price", "is_kit_parent"):
            assert field in item, f"item missing {field}: {item}"


def test_kits_list(client, sql_or_skip):
    r = client.get("/api/sql/kits", params={"limit": 5})
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert isinstance(items, list)
    for kit in items:
        assert kit.get("is_kit_parent") is True, (
            f"kit-only endpoint returned a non-kit: {kit}"
        )


def test_item_detail_404_on_unknown(client, sql_or_skip):
    r = client.get("/api/sql/items/__cntrport_no_such_item__")
    assert r.status_code == 404
    body = r.json()
    assert body.get("ok") is False
