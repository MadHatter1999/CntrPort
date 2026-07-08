"""
Storefront API for the web store (webstore/).

These are *new* aggregation endpoints - not 1:1 Counterpoint mirrors - that
shape whatever is in Counterpoint into the clean, presentation-ready JSON the
PWA storefront consumes. They are intentionally generic: no store name, no
locations, no catalog is hard-coded here. Everything is read live from
Counterpoint (SQL for bulk catalog reads, the CP API for writes/images), with
env-var overrides for the few presentation values CP doesn't own (currency,
tax rate, fallback store name).

Mounted by app.py via register_store_routes(app, ...). Kept separate from the
generic wrapper so the storefront concern never pollutes the 1:1 CP mirror.

Endpoints
  GET  /api/store/config              -> { name, currency, taxRate, stores[] }
  GET  /api/store/categories          -> [{ id, name, image, tint }]
  GET  /api/store/products            -> [{ id, name, categoryId, price, unit, image, badge }]
  GET  /api/store/item-image/<item>   -> image bytes (or an SVG placeholder)
  POST /api/store/order               -> { ok, ref, doc_id, ... }  (writes a CP Document)

Writes always go through the Counterpoint API so its triggers/replication stay
intact. SQL is read-only.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Callable

from flask import Response, jsonify, request, send_file

log = logging.getLogger("cntrport.store")

# A soft palette reused for category tiles (CP has no tile colour concept).
_TINTS = [
    "#F3D6D2", "#F6E0EC", "#FBEFD0", "#DDEFD4", "#D6E8F5", "#D7ECF0",
    "#F0E2CC", "#D5E6EA", "#E6DBCF", "#F2E2CE", "#F0E4D2", "#F4ECD2",
    "#F4D9DD", "#DCE6F2", "#E7EAD3", "#F7EBC6", "#DCEDE0",
]

# 1x1-ish neutral placeholder so a missing item photo still renders cleanly.
_PLACEHOLDER_SVG = (
    "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'>"
    "<rect width='100%' height='100%' fill='#ece7df'/>"
    "<text x='50%' y='50%' fill='#b9ae9c' font-family='sans-serif' "
    "font-size='20' text-anchor='middle' dominant-baseline='middle'>No image</text>"
    "</svg>"
)


def register_store_routes(
    app,
    *,
    cp_api_request: Callable[..., tuple[int, Any, str | None]],
    cp_upstream_call: Callable[..., dict[str, Any]],
    get_sql_connection: Callable[[], Any],
    get_existing_columns: Callable[[str], set[str]],
    safe_select: Callable[[str, Any], list[str]],
    jsonable: Callable[[Any], Any],
    config: dict[str, Any],
) -> None:
    """Attach the storefront routes to the Flask app. `config` carries env-driven
    presentation defaults (currency, tax rate, fallback store name, default
    location/customer for order writeback)."""

    def _table_exists(cur, table: str) -> bool:
        cur.execute(
            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = ?",
            table,
        )
        return cur.fetchone()[0] > 0

    def _first_existing_table(cur, candidates: list[str]) -> str | None:
        for t in candidates:
            if _table_exists(cur, t):
                return t
        return None

    # ── Config ────────────────────────────────────────────────────────────
    @app.get("/api/store/config")
    def store_config():
        """Store-wide presentation config. Name/locations are read from
        Counterpoint when available; currency and tax come from env (CP doesn't
        model a storefront tax rate)."""
        name = config.get("store_name") or ""
        if not name:
            # Try the company name from the Counterpoint API.
            try:
                status, body, _err = cp_api_request("GET", "/Company")
                if status and isinstance(body, dict):
                    name = (
                        body.get("CompanyName")
                        or body.get("COMPANY_NAME")
                        or body.get("Name")
                        or ""
                    )
            except Exception as exc:  # pragma: no cover - network/permission
                log.info("store_config: company lookup failed: %s", exc)
        if not name:
            # Fall back to SQL (SY_COMP.NAM) so the name works from SQL alone,
            # even before the CP API is wired up.
            name = _company_name_from_sql()
        if not name:
            name = "Web Store"

        return jsonify({
            "ok": True,
            "name": name,
            "currency": config.get("currency", "USD"),
            "taxRate": config.get("tax_rate", 0.0),
            "stores": _load_locations(),
        })

    def _load_locations() -> list[dict[str, Any]]:
        """Inventory locations -> storefront 'stores'. Schema-tolerant: different
        Counterpoint versions name the location table/columns differently."""
        try:
            with get_sql_connection() as cn:
                cur = cn.cursor()
                tbl = _first_existing_table(cur, ["IM_LOC", "IM_LOC_VIEW", "VI_IM_LOC"])
                if not tbl:
                    return []
                wanted = [
                    "LOC_ID", "NAM", "DESCR", "ADRS_1", "ADRS_2",
                    "CITY", "STATE", "ZIP_COD", "PHONE_1",
                ]
                cols = safe_select(tbl, wanted)
                if "LOC_ID" not in cols:
                    return []
                cur.execute(f"SELECT {', '.join(cols)} FROM {tbl} ORDER BY LOC_ID")
                out: list[dict[str, Any]] = []
                for r in cur.fetchall():
                    rec = {c: jsonable(getattr(r, c, None)) for c in cols}
                    addr = ", ".join(
                        str(rec[c]).strip()
                        for c in ("ADRS_1", "CITY", "STATE", "ZIP_COD")
                        if rec.get(c)
                    )
                    out.append({
                        "id": str(rec.get("LOC_ID", "")).strip(),
                        "name": (rec.get("NAM") or rec.get("DESCR") or rec.get("LOC_ID") or "").strip(),
                        "address": addr,
                        "phone": (rec.get("PHONE_1") or "").strip(),
                        # CP doesn't store storefront opening hours.
                        "monSat": "",
                        "sun": "",
                    })
                return out
        except Exception as exc:  # pragma: no cover
            log.info("store_config: location lookup failed: %s", exc)
            return []

    def _company_name_from_sql() -> str:
        """Company name from SQL (SY_COMP.NAM) - lets the store name resolve
        without the Counterpoint API."""
        try:
            with get_sql_connection() as cn:
                cur = cn.cursor()
                if "NAM" in get_existing_columns("SY_COMP"):
                    cur.execute("SELECT TOP (1) NAM FROM SY_COMP")
                    row = cur.fetchone()
                    if row and row[0]:
                        return str(row[0]).strip()
        except Exception as exc:  # pragma: no cover
            log.info("store_config: SQL company name failed: %s", exc)
        return ""

    # ── Categories ────────────────────────────────────────────────────────
    @app.get("/api/store/categories")
    def store_categories():
        try:
            with get_sql_connection() as cn:
                cur = cn.cursor()
                item_cols = get_existing_columns("IM_ITEM")
                ecom_col = next(
                    (c for c in ("IS_ECOMM_ITEM", "IS_ECOMMERCE", "ECOMM_ITEM") if c in item_cols),
                    None,
                )
                # Only surface categories that actually have sellable web items
                # (mirrors the product gating below).
                where = ["CATEG_COD IS NOT NULL", "CATEG_COD <> ''"]
                if "STAT" in item_cols:
                    where.append("STAT = 'A'")
                if ecom_col:
                    where.append(f"{ecom_col} = 'Y'")
                cur.execute(f"SELECT DISTINCT CATEG_COD FROM IM_ITEM WHERE {' AND '.join(where)}")
                codes = sorted({str(r[0]).strip() for r in cur.fetchall() if r[0]})

                # Pretty display names from the category description table when present
                # (IM_CATEG_COD on most installs); fall back to the code itself.
                names: dict[str, str] = {}
                cat_tbl = _first_existing_table(cur, ["IM_CATEG", "IM_CATEG_COD", "IM_CATEGORY"])
                if cat_tbl:
                    ccols = get_existing_columns(cat_tbl)
                    code_col = "CATEG_COD" if "CATEG_COD" in ccols else "COD"
                    desc_col = "DESCR" if "DESCR" in ccols else code_col
                    cur.execute(f"SELECT {code_col}, {desc_col} FROM {cat_tbl}")
                    for r in cur.fetchall():
                        if r[0] is not None:
                            code = str(r[0]).strip()
                            names[code] = str(r[1]).strip() if r[1] else code

                cats: list[dict[str, Any]] = [
                    {
                        "id": code,
                        "name": names.get(code, code),
                        "tint": _TINTS[i % len(_TINTS)],
                        "image": _category_image(cur, code),
                    }
                    for i, code in enumerate(codes)
                ]
                cats.sort(key=lambda c: c["name"].lower())
                return jsonify(cats)
        except Exception as exc:  # pragma: no cover
            log.info("store_categories failed: %s", exc)
            return jsonify([])

    def _category_image(cur, categ_cod: str) -> str:
        """Tile image for a category = the first of its items that actually has
        a photo on disk. Picking the first item blindly (old behaviour) often
        landed on an item with no image, so the tile fell through to the slow
        CP-API path and rendered nothing. Prefer a real, local, fast image."""
        try:
            # Draw the tile image only from items that are actually displayed:
            # active + e-commerce flagged, matching the products query gate.
            cols = get_existing_columns("IM_ITEM")
            ecom_col = next(
                (c for c in ("IS_ECOMM_ITEM", "IS_ECOMMERCE", "ECOMM_ITEM") if c in cols),
                None,
            )
            where = ["CATEG_COD = ?"]
            if "STAT" in cols:
                where.append("STAT = 'A'")
            if ecom_col:
                where.append(f"{ecom_col} = 'Y'")
            cur.execute(
                f"SELECT TOP (300) ITEM_NO FROM IM_ITEM "
                f"WHERE {' AND '.join(where)} ORDER BY ITEM_NO",
                categ_cod,
            )
            item_nos = [str(r.ITEM_NO).strip() for r in cur.fetchall() if r.ITEM_NO]
            if item_nos:
                base_dir = config.get("item_image_dir") or ""
                if base_dir and os.path.isdir(base_dir):
                    for iid in item_nos:
                        if _local_item_image_path(iid):
                            return f"/api/store/item-image/{iid}"
                # No local dir configured (or none of the items have a file yet):
                # keep the old behaviour so categories still get a URL.
                return f"/api/store/item-image/{item_nos[0]}"
        except Exception:
            pass
        return ""

    # ── Products ──────────────────────────────────────────────────────────
    @app.get("/api/store/products")
    def store_products():
        try:
            limit = max(1, min(int(request.args.get("limit", 1000)), 5000))
        except ValueError:
            limit = 1000
        category = request.args.get("category", "").strip()
        # Store the web sells from, used to scope store-specific planned promos.
        promo_str = str(config.get("promo_str_id") or "").strip()
        try:
            with get_sql_connection() as cn:
                cur = cn.cursor()
                cols = get_existing_columns("IM_ITEM")
                # Optional eCommerce gate - only surface items flagged for web
                # sale when the column exists; otherwise show active stock items.
                ecom_col = next(
                    (c for c in ("IS_ECOMM_ITEM", "IS_ECOMMERCE", "ECOMM_ITEM") if c in cols),
                    None,
                )
                # Regular price. Kit items (IM_KIT_PAR) are priced at the parent,
                # which carries this price - no component summing needed.
                price_col = next((c for c in ("PRC_1", "REG_PRC", "PRC_2") if c in cols), "PRC_1")
                unit_col = next((c for c in ("SELL_UNIT", "STK_UNIT", "DFLT_UNIT") if c in cols), None)
                stat_col = "STAT" if "STAT" in cols else None

                sel = ["i.ITEM_NO", "i.DESCR", "i.CATEG_COD", f"i.{price_col} AS reg_prc"]
                if unit_col:
                    sel.append(f"i.{unit_col} AS sell_unit")

                # Lowest active planned-promo price for today (CP "Planned Promotions":
                # IM_PLAN_PROMO_RUL.PROMO_PRC, gated by the group's BEG_DAT..END_DAT
                # window and store). Scheduled promos light up automatically when their
                # window opens. Skipped gracefully if the promo tables aren't present.
                promo_params: list[Any] = []
                if _table_exists(cur, "IM_PLAN_PROMO_RUL") and _table_exists(cur, "IM_PLAN_PROMO_GRP"):
                    store_cond = ""
                    if promo_str:
                        store_cond = " AND (g.STR_ID = ? OR g.STR_ID IS NULL OR g.STR_ID = '')"
                        promo_params.append(promo_str)
                    sel.append(
                        "(SELECT MIN(r.PROMO_PRC) FROM IM_PLAN_PROMO_RUL r "
                        "JOIN IM_PLAN_PROMO_GRP g ON g.GRP_COD = r.GRP_COD "
                        "WHERE r.ITEM_NO = i.ITEM_NO "
                        "AND CAST(GETDATE() AS date) BETWEEN CAST(g.BEG_DAT AS date) AND CAST(g.END_DAT AS date)"
                        f"{store_cond}) AS promo_prc"
                    )
                else:
                    sel.append("CAST(NULL AS decimal(15,4)) AS promo_prc")

                where = ["1=1"]
                tail_params: list[Any] = []
                if stat_col:
                    where.append(f"i.{stat_col} = 'A'")
                if ecom_col:
                    where.append(f"i.{ecom_col} = 'Y'")
                if category:
                    where.append("i.CATEG_COD = ?")
                    tail_params.append(category)

                sql = (
                    f"SELECT TOP ({limit}) {', '.join(sel)} FROM IM_ITEM i "
                    f"WHERE {' AND '.join(where)} ORDER BY i.DESCR"
                )
                # SELECT params (promo store) bind before WHERE params (category).
                cur.execute(sql, promo_params + tail_params)
                products: list[dict[str, Any]] = []
                for r in cur.fetchall():
                    item_no = str(getattr(r, "ITEM_NO", "")).strip()
                    if not item_no:
                        continue
                    reg = float(jsonable(getattr(r, "reg_prc", None)) or 0)
                    unit = (str(getattr(r, "sell_unit")).strip() if unit_col else "") or "ea"
                    rec: dict[str, Any] = {
                        "id": item_no,
                        "name": (getattr(r, "DESCR", None) or item_no).strip(),
                        "categoryId": (getattr(r, "CATEG_COD", None) or "").strip(),
                        "price": reg,
                        "unit": unit,
                        "image": f"/api/store/item-image/{item_no}",
                    }
                    # Active promo beats the regular price -> show sale + struck-out was.
                    promo_raw = jsonable(getattr(r, "promo_prc", None))
                    if promo_raw is not None:
                        promo = float(promo_raw)
                        if 0 < promo < reg:
                            rec["price"] = promo
                            rec["wasPrice"] = reg
                            rec["badge"] = "sale"
                    products.append(rec)
                return jsonify(products)
        except Exception as exc:  # pragma: no cover
            log.info("store_products failed: %s", exc)
            return jsonify([])

    # ── Item image (best-effort, always renders something) ─────────────────
    # Order of preference:
    #   1. the file on the CP server (Configuration\ItemImages\<ITEM_NO>.<ext>)
    #   2. the CP web API image proxy
    #   3. an inline "No image" SVG placeholder
    _IMG_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp")
    # Long cache: item art rarely changes and send_file adds an ETag, so the
    # browser revalidates with a cheap 304 instead of re-downloading the bytes.
    _IMG_MAX_AGE = 604800  # 7 days

    def _find_in_dir(base_dir: str, item_no: str) -> str | None:
        """Path to <ITEM_NO>.<ext> in base_dir, or None. <path:item_no> can
        contain separators, so collapse to a bare filename first - a crafted id
        must not escape the directory."""
        if not base_dir or not os.path.isdir(base_dir):
            return None
        safe = os.path.basename(item_no.strip())
        if not safe or safe in (".", "..") or "/" in safe or "\\" in safe:
            return None
        for ext in _IMG_EXTS:
            path = os.path.join(base_dir, safe + ext)
            if os.path.isfile(path):
                return path
        return None

    def _local_item_image_path(item_no: str) -> str | None:
        """Real photo for the item from the Counterpoint ItemImages directory."""
        return _find_in_dir(config.get("item_image_dir") or "", item_no)

    def _placeholder(max_age: int = 3600) -> Response:
        return Response(
            _PLACEHOLDER_SVG,
            status=200,
            content_type="image/svg+xml",
            headers={"Cache-Control": f"public, max-age={max_age}"},
        )

    @app.get("/api/store/item-image/<path:item_no>")
    def store_item_image(item_no: str):
        item_no = item_no.strip()

        # 1) Local file on the CP server - fast, cached, conditional (304 on
        #    revalidate). This is the source of truth for this deployment.
        path = _local_item_image_path(item_no)
        if path:
            resp = send_file(path, conditional=True, max_age=_IMG_MAX_AGE)
            resp.headers["Cache-Control"] = f"public, max-age={_IMG_MAX_AGE}"
            return resp

        # 2) No real photo: serve the item's labeled placeholder art so the card
        #    never renders blank (still fast + cached).
        ph = _find_in_dir(config.get("item_placeholder_dir") or "", item_no)
        if ph:
            resp = send_file(ph, conditional=True, max_age=86400)
            resp.headers["Cache-Control"] = "public, max-age=86400"
            return resp

        # 3) When a local ItemImages dir is configured it IS the catalogue's
        #    image source, so a miss should return instantly. Falling through to
        #    the CP web API here is what made the storefront crawl: an
        #    unreachable/slow CP API blocked every missing image up to the 60s
        #    upstream timeout. Return the generic placeholder immediately instead.
        if config.get("item_image_dir"):
            return _placeholder()

        # 4) Legacy path (no local dir configured): proxy the CP web API.
        try:
            status, body, _err = cp_api_request("GET", f"/Item/{item_no}/Images")
            filename = _first_image_filename(body)
            if status == 200 and filename:
                result = cp_upstream_call("GET", f"/Item/Images/{filename}", None, {})
                if result.get("status") == 200 and isinstance(result.get("body"), (bytes, bytearray)):
                    return Response(
                        bytes(result["body"]),
                        status=200,
                        content_type=result.get("content_type") or "image/jpeg",
                        headers={"Cache-Control": "public, max-age=86400"},
                    )
        except Exception as exc:  # pragma: no cover
            log.info("item-image %s failed: %s", item_no, exc)
        return Response(_PLACEHOLDER_SVG, status=200, content_type="image/svg+xml")

    def _first_image_filename(body: Any) -> str | None:
        """Pull the first image filename out of the varied shapes /Item/{}/Images
        returns across Counterpoint versions."""
        items = body
        if isinstance(body, dict):
            items = (
                body.get("Images")
                or body.get("images")
                or body.get("ItemImages")
                or body.get("value")
                or []
            )
        if not isinstance(items, list) or not items:
            return None
        first = items[0]
        if isinstance(first, str):
            return first
        if isinstance(first, dict):
            for k in ("Filename", "FileName", "Name", "ImageName", "filename"):
                if first.get(k):
                    return str(first[k])
        return None

    # ── Order writeback -> Counterpoint Document ──────────────────────────
    @app.post("/api/store/order")
    def store_order():
        payload = request.get_json(silent=True) or {}
        items = payload.get("items") or []
        if not items:
            return jsonify({"ok": False, "message": "No line items in order."}), 400

        customer = payload.get("customer") or {}
        loc_id = (payload.get("storeId") or config.get("default_loc_id") or "").strip()
        cust_no = (payload.get("custNo") or config.get("default_cust_no") or "").strip()

        # A reasonable, generic Counterpoint ticket. Different installs require
        # different header fields; this is the common shape. Hooks in
        # __CntrPHooks__.py (post_document) can reshape it per deployment.
        lines = []
        for it in items:
            try:
                qty = float(it.get("qty") or 0)
            except (TypeError, ValueError):
                qty = 0
            if qty <= 0:
                continue
            line = {"ITEM_NO": str(it.get("id", "")).strip(), "QTY_SOLD": qty}
            if it.get("price") is not None:
                try:
                    line["PRC"] = float(it["price"])
                except (TypeError, ValueError):
                    pass
            lines.append(line)

        hdr: dict[str, Any] = {"TKT_TYP": "T", "DOC_TYP": "T"}
        if loc_id:
            hdr["STK_LOC_ID"] = loc_id
        if cust_no:
            hdr["CUST_NO"] = cust_no
        notes = customer.get("notes")

        document = {
            "PS_DOC_HDR": hdr,
            "PS_DOC_LIN": lines,
            # Echo the web context so a post_document hook / report can use it.
            "_web": {
                "customer": customer,
                "fulfillment": payload.get("fulfillment"),
                "ref": payload.get("ref"),
                "notes": notes,
            },
        }

        try:
            status, body, err = cp_api_request("POST", "/Document", json=document)
        except Exception as exc:  # pragma: no cover
            log.warning("store_order: CP Document POST raised: %s", exc)
            status, body, err = 0, None, str(exc)

        doc_id = None
        if isinstance(body, dict):
            doc_id = body.get("DocId") or body.get("DOC_ID") or body.get("Id")

        ok = bool(status and 200 <= status < 300)
        # Always 200 to the storefront: the admin screen is the source of truth
        # and logs the order regardless; surface CP success/failure in the body.
        return jsonify({
            "ok": ok,
            "ref": payload.get("ref"),
            "doc_id": doc_id,
            "counterpoint_status": status,
            "counterpoint_error": err,
            "counterpoint_response": body if ok else (body or err),
        })

    # ── Payment processor config ──────────────────────────────────────────
    # Stored server-side (holds gateway secret keys) and NEVER shipped whole to
    # the browser. The public storefront reads only /payments/status (secret-
    # free); the admin reads/writes /payments/config behind the wrapper API key.
    # When no provider is enabled + fully configured, status is "demo" and the
    # storefront keeps its existing demo checkout.
    def _payments_path() -> str:
        return config.get("payments_config_path") or ""

    def _default_payments() -> dict[str, Any]:
        return {"provider": "", "enabled": False, "environment": "sandbox",
                "values": {}, "meta": {"secret": [], "required": []}}

    def _load_payments() -> dict[str, Any]:
        path = _payments_path()
        if path and os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                if isinstance(data, dict):
                    return data
            except (OSError, ValueError) as exc:  # pragma: no cover
                log.warning("payments config read failed: %s", exc)
        return _default_payments()

    def _save_payments(cfg: dict[str, Any]) -> bool:
        path = _payments_path()
        if not path:
            return False
        try:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(cfg, fh, indent=1)
            return True
        except OSError as exc:  # pragma: no cover
            log.warning("payments config write failed: %s", exc)
            return False

    def _secret_keys(cfg: dict[str, Any]) -> set[str]:
        return set((cfg.get("meta") or {}).get("secret") or [])

    def _payment_is_live(cfg: dict[str, Any]) -> bool:
        """Live only when explicitly enabled AND every required field is filled
        - otherwise the storefront falls back to demo."""
        if not cfg.get("enabled") or not cfg.get("provider"):
            return False
        values = cfg.get("values") or {}
        required = (cfg.get("meta") or {}).get("required") or []
        return all(str(values.get(k, "")).strip() for k in required)

    @app.get("/api/store/payments/status")
    def payments_status():
        cfg = _load_payments()
        live = _payment_is_live(cfg)
        secrets = _secret_keys(cfg)
        values = cfg.get("values") or {}
        public = {k: v for k, v in values.items() if k not in secrets and v}
        return jsonify({
            "mode": "live" if live else "demo",
            "provider": cfg.get("provider") or "",
            "environment": cfg.get("environment") or "",
            "publicConfig": public if live else {},
        })

    @app.get("/api/store/payments/config")
    def payments_config_get():
        cfg = _load_payments()
        secrets = _secret_keys(cfg)
        values = cfg.get("values") or {}
        return jsonify({
            "enabled": bool(cfg.get("enabled")),
            "provider": cfg.get("provider") or "",
            "environment": cfg.get("environment") or "sandbox",
            "live": _payment_is_live(cfg),
            # Secret VALUES are never returned - only whether each is set.
            "values": {k: v for k, v in values.items() if k not in secrets},
            "secretsSet": {k: bool(str(values.get(k, "")).strip()) for k in secrets},
        })

    @app.put("/api/store/payments/config")
    def payments_config_put():
        body = request.get_json(silent=True) or {}
        provider = str(body.get("provider") or "").strip()
        environment = str(body.get("environment") or "sandbox").strip()
        enabled = bool(body.get("enabled"))
        in_values = body.get("values") or {}
        meta = body.get("meta") or {}
        secret_keys = set(meta.get("secret") or [])

        current = _load_payments()
        # Keep prior secret values only when the provider is unchanged.
        cur_values = (current.get("values") or {}) if current.get("provider") == provider else {}

        merged: dict[str, Any] = {}
        for k, v in in_values.items():
            v = "" if v is None else str(v).strip()
            # A blank secret means "keep what's already saved" so the admin never
            # has to re-enter secrets; blank non-secret clears the field.
            if k in secret_keys and v == "":
                if cur_values.get(k):
                    merged[k] = cur_values[k]
            else:
                merged[k] = v

        cfg = {
            "provider": provider,
            "enabled": enabled,
            "environment": environment,
            "values": merged,
            "meta": {
                "secret": sorted(secret_keys),
                "required": list(meta.get("required") or []),
            },
        }
        ok = _save_payments(cfg)
        return jsonify({"ok": ok, "live": _payment_is_live(cfg) if ok else False}), (
            200 if ok else 500
        )
