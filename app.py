"""
Flask wrapper in front of the NCR Counterpoint REST API.

Every guide endpoint is registered as a typed route in cp_endpoints.py and
gets pre/during/post hooks (see __CntrPHooks__.py). Anything not registered
still works via the generic /api/cp/<path> mirror.

Two ground rules: SQL is read-only - all writes go through the Counterpoint
API so its triggers and replication stay intact. Counterpoint credentials
(Basic + APIKey) are injected from .env server-side; callers never see them.
"""

from __future__ import annotations

import os
import re
import logging
import secrets
from decimal import Decimal
from typing import Any, Iterable

import pyodbc
import requests
import urllib3
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request
from requests.auth import HTTPBasicAuth

import cp_endpoints

load_dotenv()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()

def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}

def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default

CP_API_BASE_URL    = _env("CP_API_BASE_URL", "https://localhost:52000").rstrip("/")
CP_COMPANY_ALIAS   = _env("CP_COMPANY_ALIAS")
CP_API_USERNAME    = _env("CP_API_USERNAME")
CP_API_PASSWORD    = _env("CP_API_PASSWORD")
CP_API_KEY         = _env("CP_API_KEY")
CP_API_KEY_HEADER  = _env("CP_API_KEY_HEADER", "APIKey")
CP_API_VERIFY_SSL  = _env_bool("CP_API_VERIFY_SSL", True)
# When true, callers can opt out of the hook pipeline on a per-request basis
# via `?_direct=1` (query) or `X-CntrP-Mode: direct` (header). The request
# then forwards to NCR raw and the response is returned unmodified.
# Default false: keeps compliance/redact hooks from being trivially bypassed.
CP_ALLOW_DIRECT_MODE = _env_bool("CP_ALLOW_DIRECT_MODE", False)

# Wrapper-level API key. When set, every caller must send it in the header
# named by CNTRPORT_API_KEY_HEADER (default: X-API-Key). Leave blank to keep
# the wrapper open (legacy behavior - rely on network-level auth only).
# This is the *caller's* key into this wrapper. It's separate from CP_API_KEY,
# which is the wrapper's key into NCR, and is never forwarded upstream.
CNTRPORT_API_KEY        = _env("CNTRPORT_API_KEY")
CNTRPORT_API_KEY_HEADER = _env("CNTRPORT_API_KEY_HEADER", "X-API-Key")
# Paths that bypass the wrapper API key check (e.g. health probes for
# monitors and load balancers). Comma-separated list of exact paths.
CNTRPORT_AUTH_EXEMPT_PATHS = {
    p.strip() for p in _env("CNTRPORT_AUTH_EXEMPT_PATHS", "/api/health").split(",")
    if p.strip()
}
# Path *prefixes* that bypass the wrapper API key check. Item images are loaded
# by the browser via plain <img src> tags, which cannot carry the X-API-Key
# header, so they must be reachable without it - the bytes are just public
# product photos. Comma-separated list of prefixes.
CNTRPORT_AUTH_EXEMPT_PREFIXES = tuple(
    p.strip() for p in _env(
        "CNTRPORT_AUTH_EXEMPT_PREFIXES",
        # item images load via header-less <img>; the payment/SMS *status*
        # endpoints are secret-free reads the public storefront needs (live vs
        # demo checkout, show/hide text opt-ins). Config writes stay gated.
        "/api/store/item-image/,/api/store/payments/status,/api/store/sms/status",
    ).split(",")
    if p.strip()
)

# The Twilio inbound webhook (STOP/ARRET replies) can never carry our API key
# header - Twilio doesn't send custom headers. It is exempted from the key gate
# unconditionally and authenticated by its X-Twilio-Signature instead
# (validated in sms_api.py), so it stays safe even when someone trims the
# CNTRPORT_AUTH_EXEMPT_* env vars.
SMS_INBOUND_WEBHOOK_PATH = "/api/store/sms/inbound"

CP_SQL_SERVER      = _env("CP_SQL_SERVER", ".")
CP_SQL_DATABASE    = _env("CP_SQL_DATABASE")
CP_SQL_USER        = _env("CP_SQL_USER", "sa")
CP_SQL_PASSWORD    = _env("CP_SQL_PASSWORD")
CP_SQL_DRIVER      = _env("CP_SQL_DRIVER", "ODBC Driver 17 for SQL Server")

# Counterpoint keeps item photos on disk under the company's Configuration
# folder, by convention:
#   <Toplevel>\<Company>\Configuration\ItemImages\<ITEM_NO>.<ext>
# The storefront image API serves these files directly - the correct image
# for the item, from the CP server itself - and only falls back to the CP web
# API when no local file exists. CP_ITEM_IMAGE_DIR overrides the full path;
# otherwise it's derived from the toplevel dir + the company alias so pointing
# at a different server/company is a one-line env change (never hard-coded).
CP_TOPLEVEL_DIR    = _env(
    "CP_TOPLEVEL_DIR",
    r"C:\Program Files (x86)\Radiant Systems\CounterPoint\CPSQL.1\Toplevel",
)
CP_ITEM_IMAGE_DIR  = _env("CP_ITEM_IMAGE_DIR")
if not CP_ITEM_IMAGE_DIR and CP_TOPLEVEL_DIR and CP_COMPANY_ALIAS:
    CP_ITEM_IMAGE_DIR = os.path.join(
        CP_TOPLEVEL_DIR, CP_COMPANY_ALIAS, "Configuration", "ItemImages"
    )

# Placeholder art for items that have no real photo yet: served after the real
# ItemImages dir misses, so nothing renders blank. Defaults to a _placeholders
# subfolder of the ItemImages dir so it travels with the same copy to the server.
CP_ITEM_PLACEHOLDER_DIR = _env("CP_ITEM_PLACEHOLDER_DIR")
if not CP_ITEM_PLACEHOLDER_DIR and CP_ITEM_IMAGE_DIR:
    CP_ITEM_PLACEHOLDER_DIR = os.path.join(CP_ITEM_IMAGE_DIR, "_placeholders")

# Where the admin-configured payment-processor settings are stored (JSON on the
# server, never in the browser bundle, since it holds gateway secret keys). Git-
# ignored. The public storefront only ever sees the secret-free status view.
CP_PAYMENTS_CONFIG_PATH = _env(
    "CP_PAYMENTS_CONFIG_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "payments.json"),
)

# Admin edits to shared item fields (description, category, price, unit) are
# written back to Counterpoint. NCR's API has no item-write endpoint, so this is
# a direct SQL UPDATE of IM_ITEM - it bypasses CP maintenance triggers, so it is
# OFF by default and must be explicitly enabled per install.
CP_ALLOW_ITEM_WRITE = _env_bool("CP_ALLOW_ITEM_WRITE", False)

# Storefront (webstore/) presentation + order-writeback config. The catalog,
# categories and locations are read live from Counterpoint; these cover the few
# things CP doesn't model for a web store.
STORE_NAME         = _env("STORE_NAME")                     # blank -> use CP company name
STORE_CURRENCY     = _env("STORE_CURRENCY", "USD")
STORE_TAX_RATE     = float(_env("STORE_TAX_RATE", "0") or 0)
# Forgive percent-style entries: a storefront tax rate is a decimal (0.15), never
# >100%. So 15 -> 0.15, 14 -> 0.14. Avoids a 1400%-tax footgun.
if STORE_TAX_RATE > 1:
    STORE_TAX_RATE = STORE_TAX_RATE / 100.0
STORE_DEFAULT_LOC_ID  = _env("STORE_DEFAULT_LOC_ID")        # location for web orders
STORE_DEFAULT_CUST_NO = _env("STORE_DEFAULT_CUST_NO")       # walk-in/web customer no
# Store (STR_ID) used to scope store-specific planned promotions. Defaults to the
# web order location when unset (they share names on most installs).
STORE_PROMO_STR_ID    = _env("STORE_PROMO_STR_ID")

# NCR /Document header identity for web-order tickets. These MUST be valid on the
# install (a real store / station / drawer / user), or Counterpoint rejects the
# POST. Defaults mirror the NCR APIGuide minimal example - override per install.
STORE_DOC_STR_ID  = _env("STORE_DOC_STR_ID", STORE_PROMO_STR_ID or "MAIN")
STORE_DOC_STA_ID  = _env("STORE_DOC_STA_ID", "1")
STORE_DOC_DRW_ID  = _env("STORE_DOC_DRW_ID", "1")
STORE_DOC_USR_ID  = _env("STORE_DOC_USR_ID", CP_API_USERNAME or "API")
STORE_DOC_TKT_TYP = _env("STORE_DOC_TKT_TYP", "T")   # ticket
STORE_DOC_DOC_TYP = _env("STORE_DOC_DOC_TYP", "O")   # order

# Twilio SMS: order receipts + opted-in marketing texts (see sms_api.py for
# the CASL/PCI compliance notes). All optional - when the Twilio values are
# blank the storefront simply hides its text opt-ins and the endpoints report
# disabled instead of failing.
TWILIO_ACCOUNT_SID           = _env("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN            = _env("TWILIO_AUTH_TOKEN")
TWILIO_FROM_NUMBER           = _env("TWILIO_FROM_NUMBER")            # E.164, e.g. +19025550123
TWILIO_MESSAGING_SERVICE_SID = _env("TWILIO_MESSAGING_SERVICE_SID")  # optional, overrides From
# CASL proof-of-consent ledger (who opted in, when, with what wording) plus the
# campaign send log. JSON on the server, git-ignored like payments.json.
SMS_CONSENT_PATH = _env(
    "SMS_CONSENT_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "sms_consent.json"),
)
# Marketing send window (hours, server-local). Campaigns outside it are refused.
SMS_QUIET_START = _env_int("SMS_QUIET_START", 9)
SMS_QUIET_END   = _env_int("SMS_QUIET_END", 21)
# Optional CASL sender-contact line appended to marketing texts (website/phone).
SMS_CONTACT_INFO = _env("SMS_CONTACT_INFO")
# External base URL Twilio calls the inbound webhook on (needed for signature
# validation behind a proxy/tunnel, e.g. https://shop.example.com).
SMS_PUBLIC_BASE_URL = _env("SMS_PUBLIC_BASE_URL")

FLASK_HOST  = _env("FLASK_HOST", "0.0.0.0")
FLASK_PORT  = _env_int("FLASK_PORT", 5000)
FLASK_DEBUG = _env_bool("FLASK_DEBUG", True)

# Silence noisy SSL warnings when CP_API_VERIFY_SSL is disabled for local dev.
if not CP_API_VERIFY_SSL:
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Don't leak secrets via logs.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("orderentry")

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Wrapper API-key gate
# ---------------------------------------------------------------------------

@app.before_request
def _require_wrapper_api_key():
    """Reject any request that doesn't carry the configured wrapper API key.

    Opt-in: if CNTRPORT_API_KEY is unset, the gate is a no-op (preserves
    legacy "no auth" behavior). When set, callers must send the same value
    in CNTRPORT_API_KEY_HEADER (default: X-API-Key). compare_digest avoids
    timing-side-channel leakage on the comparison.
    """
    if not CNTRPORT_API_KEY:
        return None
    if request.path in CNTRPORT_AUTH_EXEMPT_PATHS:
        return None
    if request.path.startswith(CNTRPORT_AUTH_EXEMPT_PREFIXES):
        return None
    if request.path == SMS_INBOUND_WEBHOOK_PATH:
        # Twilio-signed webhook; sms_api.py validates X-Twilio-Signature.
        return None
    supplied = request.headers.get(CNTRPORT_API_KEY_HEADER, "")
    if not supplied or not secrets.compare_digest(supplied, CNTRPORT_API_KEY):
        return jsonify({
            "ok": False,
            "message": f"Missing or invalid {CNTRPORT_API_KEY_HEADER} header.",
        }), 401
    return None

# ---------------------------------------------------------------------------
# SQL helpers (READ-ONLY by application behavior)
# ---------------------------------------------------------------------------

def get_sql_connection() -> pyodbc.Connection:
    """Open a pyodbc connection. Caller is responsible for closing it."""
    conn_str = (
        f"DRIVER={{{CP_SQL_DRIVER}}};"
        f"SERVER={CP_SQL_SERVER};"
        f"DATABASE={CP_SQL_DATABASE};"
        f"UID={CP_SQL_USER};"
        f"PWD={CP_SQL_PASSWORD};"
        f"TrustServerCertificate=yes;"
    )
    return pyodbc.connect(conn_str, timeout=10)


def _row_to_dict(cursor: pyodbc.Cursor, row: pyodbc.Row) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for col, val in zip(cursor.description, row):
        out[col[0]] = _jsonable(val)
    return out


def _jsonable(val: Any) -> Any:
    if isinstance(val, Decimal):
        return float(val)
    if isinstance(val, (bytes, bytearray)):
        try:
            return val.decode("utf-8", errors="replace")
        except Exception:
            return None
    return val


_COLUMN_CACHE: dict[str, set[str]] = {}

def get_existing_columns(table_name: str) -> set[str]:
    """Return the set of column names that exist in the given table.

    Cached per-process. Used for resilient SELECTs against schemas that vary
    between Counterpoint versions / customizations.
    """
    if table_name in _COLUMN_CACHE:
        return _COLUMN_CACHE[table_name]
    sql = (
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_NAME = ?"
    )
    cols: set[str] = set()
    with get_sql_connection() as cn:
        cur = cn.cursor()
        cur.execute(sql, table_name)
        for (name,) in cur.fetchall():
            cols.add(name)
    _COLUMN_CACHE[table_name] = cols
    return cols


def _safe_select(table: str, wanted: Iterable[str]) -> list[str]:
    existing = get_existing_columns(table)
    return [c for c in wanted if c in existing]


def _sql_error(message: str, exc: Exception):
    log.warning("SQL error: %s: %s", message, exc)
    return jsonify({"ok": False, "message": message, "error": str(exc)}), 500

# ---------------------------------------------------------------------------
# Counterpoint API helper
# ---------------------------------------------------------------------------

def _cp_auth() -> HTTPBasicAuth:
    user = f"{CP_COMPANY_ALIAS}.{CP_API_USERNAME}"
    return HTTPBasicAuth(user, CP_API_PASSWORD)

def _cp_headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if CP_API_KEY:
        headers[CP_API_KEY_HEADER] = CP_API_KEY
    if extra:
        headers.update(extra)
    return headers

def cp_api_request(
    method: str,
    path: str,
    json: Any = None,
    params: dict[str, Any] | None = None,
    timeout: int = 30,
) -> tuple[int, Any, str | None]:
    """Send a request to the Counterpoint API.

    Returns: (status_code, parsed_body_or_text, error_message_or_None)
    """
    url = f"{CP_API_BASE_URL}/{path.lstrip('/')}"
    try:
        resp = requests.request(
            method=method.upper(),
            url=url,
            json=json,
            params=params,
            auth=_cp_auth(),
            headers=_cp_headers(),
            verify=CP_API_VERIFY_SSL,
            timeout=timeout,
        )
    except requests.RequestException as exc:
        log.warning("Counterpoint API transport error: %s %s -> %s", method, path, exc)
        return 0, None, f"Transport error: {exc}"

    body: Any
    try:
        body = resp.json()
    except ValueError:
        body = resp.text

    if resp.ok:
        return resp.status_code, body, None
    return resp.status_code, body, f"HTTP {resp.status_code}"

# ---------------------------------------------------------------------------
# Routes - health
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    sql_status: dict[str, Any] = {"ok": False, "database": CP_SQL_DATABASE}
    try:
        with get_sql_connection() as cn:
            cur = cn.cursor()
            cur.execute("SELECT 1")
            cur.fetchone()
        sql_status["ok"] = True
    except Exception as exc:
        sql_status["error"] = str(exc)

    cp_status: dict[str, Any] = {"ok": False, "base_url": CP_API_BASE_URL}
    # Best-effort ping. Some installs don't expose a root endpoint, so a 401/404
    # still proves the server answered.
    try:
        status, _body, err = cp_api_request("GET", "/")
        if status:
            cp_status["ok"] = True
            cp_status["status_code"] = status
        else:
            cp_status["error"] = err
    except Exception as exc:
        cp_status["error"] = str(exc)

    return jsonify({
        "ok": sql_status["ok"],
        "company_alias": CP_COMPANY_ALIAS,
        "sql": sql_status,
        "counterpoint_api": cp_status,
    })

# Built-in SQL extensions. Read-only catalog and kit lookups for things NCR's
# API doesn't surface cleanly. The real framework pieces are the helpers
# above (get_sql_connection, _safe_select, get_existing_columns); these
# routes are just examples - feel free to rip them out and write your own.

@app.get("/api/sql/items")
def sql_items():
    q = request.args.get("q", "").strip()
    try:
        limit = max(1, min(int(request.args.get("limit", 100)), 1000))
    except ValueError:
        limit = 100
    kits_only = request.args.get("kits_only", "").lower() in {"1", "true", "yes"}
    category = request.args.get("category", "").strip()
    subcategory = request.args.get("subcategory", "").strip()

    like = f"%{q}%"
    sql = f"""
        SELECT TOP ({limit})
            ITEM_NO, DESCR, CATEG_COD, SUBCAT_COD, PRC_1, IS_KIT_PAR
        FROM IM_ITEM
        WHERE
            (? = '' OR ITEM_NO LIKE ? OR DESCR LIKE ?)
            AND (? = '' OR CATEG_COD = ?)
            AND (? = '' OR SUBCAT_COD = ?)
            AND (? = 0 OR IS_KIT_PAR = 'Y')
        ORDER BY ITEM_NO
    """
    params = (
        q, like, like,
        category, category,
        subcategory, subcategory,
        1 if kits_only else 0,
    )
    try:
        with get_sql_connection() as cn:
            cur = cn.cursor()
            cur.execute(sql, params)
            items = [
                {
                    "item_no": r.ITEM_NO,
                    "description": r.DESCR,
                    "category": r.CATEG_COD,
                    "subcategory": r.SUBCAT_COD,
                    "price": _jsonable(r.PRC_1),
                    "is_kit_parent": (r.IS_KIT_PAR or "").upper() == "Y",
                }
                for r in cur.fetchall()
            ]
        return jsonify({"items": items})
    except Exception as exc:
        return _sql_error("SQL item search failed.", exc)


@app.get("/api/sql/items/<item_no>")
def sql_item_detail(item_no: str):
    item_no = item_no.strip()
    if not item_no:
        return jsonify({"ok": False, "message": "item_no required"}), 400

    wanted = [
        "ITEM_NO", "DESCR", "CATEG_COD", "SUBCAT_COD",
        "PRC_1", "PRC_2", "PRC_3",
        "IS_KIT_PAR", "IS_TXBL", "STAT",
        "LST_COST", "REG_PRC",
        "ITEM_VEND_NO", "VEND_ITEM_NO", "USR_ITEM_NO",
        "DIM_1_UPR", "DIM_2_UPR", "DIM_3_UPR",
        "LONG_DESCR", "ADDL_DESCR_1", "ADDL_DESCR_2",
        "TRK_METH", "TAX_CATEG", "PRC_GRP_COD",
    ]
    try:
        cols = _safe_select("IM_ITEM", wanted)
        if not cols:
            return jsonify({"ok": False, "message": "IM_ITEM has none of the expected columns."}), 500
        col_list = ", ".join(cols)
        sql = f"SELECT TOP (1) {col_list} FROM IM_ITEM WHERE ITEM_NO = ?"
        with get_sql_connection() as cn:
            cur = cn.cursor()
            cur.execute(sql, item_no)
            row = cur.fetchone()
            if not row:
                return jsonify({"ok": False, "message": "Item not found."}), 404
            return jsonify({"ok": True, "item": _row_to_dict(cur, row)})
    except Exception as exc:
        return _sql_error("Item detail query failed.", exc)


@app.get("/api/sql/kits")
def sql_kits():
    q = request.args.get("q", "").strip()
    try:
        limit = max(1, min(int(request.args.get("limit", 100)), 1000))
    except ValueError:
        limit = 100
    like = f"%{q}%"
    sql = f"""
        SELECT TOP ({limit})
            ITEM_NO, DESCR, CATEG_COD, SUBCAT_COD, PRC_1, IS_KIT_PAR
        FROM IM_ITEM
        WHERE IS_KIT_PAR = 'Y'
          AND (? = '' OR ITEM_NO LIKE ? OR DESCR LIKE ?)
        ORDER BY ITEM_NO
    """
    try:
        with get_sql_connection() as cn:
            cur = cn.cursor()
            cur.execute(sql, (q, like, like))
            items = [
                {
                    "item_no": r.ITEM_NO,
                    "description": r.DESCR,
                    "category": r.CATEG_COD,
                    "subcategory": r.SUBCAT_COD,
                    "price": _jsonable(r.PRC_1),
                    "is_kit_parent": True,
                }
                for r in cur.fetchall()
            ]
        return jsonify({"items": items})
    except Exception as exc:
        return _sql_error("Kits query failed.", exc)


# Tables we'll probe in order when looking for kit components.
# Counterpoint variants have used a few different names over the years.
_KIT_COMPONENT_TABLE_GUESSES = [
    "IM_PRC_KIT_COMP",
    "IM_KIT_COMP",
    "IM_KIT_COMPONENT",
    "IM_KIT_DTL",
    "IM_KIT",
    "IM_BOM",
    "IM_BOM_COMP",
]

@app.get("/api/sql/items/<item_no>/kit-components")
def sql_kit_components(item_no: str):
    item_no = item_no.strip()
    if not item_no:
        return jsonify({"ok": False, "message": "item_no required"}), 400

    try:
        with get_sql_connection() as cn:
            cur = cn.cursor()

            # Confirm the parent exists and is flagged as a kit.
            cur.execute(
                "SELECT TOP (1) ITEM_NO, DESCR, IS_KIT_PAR "
                "FROM IM_ITEM WHERE ITEM_NO = ?",
                item_no,
            )
            parent_row = cur.fetchone()
            if not parent_row:
                return jsonify({"ok": False, "message": "Parent item not found."}), 404
            is_kit_parent = (parent_row.IS_KIT_PAR or "").upper() == "Y"

            # --- Stage A: try known component table names ------------------
            for tbl in _KIT_COMPONENT_TABLE_GUESSES:
                cur.execute(
                    "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES "
                    "WHERE TABLE_NAME = ?",
                    tbl,
                )
                if cur.fetchone()[0] == 0:
                    continue

                cols = get_existing_columns(tbl)
                # Pick the parent column.
                parent_col = next(
                    (c for c in ("KIT_ITEM_NO", "PAR_ITEM_NO", "PARENT_ITEM_NO", "ITEM_NO")
                     if c in cols),
                    None,
                )
                # Pick the component column.
                comp_col = next(
                    (c for c in ("COMP_ITEM_NO", "COMPONENT_ITEM_NO", "CHILD_ITEM_NO", "ITEM_NO")
                     if c in cols and c != parent_col),
                    None,
                )
                if not parent_col or not comp_col:
                    continue

                # Optional quantity column.
                qty_col = next(
                    (c for c in ("QTY", "COMP_QTY", "QUANTITY", "QTY_PER")
                     if c in cols),
                    None,
                )
                select_cols = [parent_col, comp_col]
                if qty_col:
                    select_cols.append(qty_col)
                select_sql = ", ".join(select_cols)
                cur.execute(
                    f"SELECT {select_sql} FROM {tbl} WHERE {parent_col} = ?",
                    item_no,
                )
                rows = cur.fetchall()
                components = []
                for r in rows:
                    rec = {
                        "parent_item_no": getattr(r, parent_col),
                        "component_item_no": getattr(r, comp_col),
                    }
                    if qty_col:
                        rec["quantity"] = _jsonable(getattr(r, qty_col))
                    components.append(rec)

                return jsonify({
                    "ok": True,
                    "item_no": item_no,
                    "is_kit_parent": is_kit_parent,
                    "component_table_found": True,
                    "component_table": tbl,
                    "component_columns": {
                        "parent": parent_col,
                        "component": comp_col,
                        "quantity": qty_col,
                    },
                    "components": components,
                    "message": (
                        f"Found {len(components)} component(s) in {tbl}."
                        if components else
                        f"{tbl} matched the parent column but returned no rows."
                    ),
                })

            # --- Stage B: diagnostics --------------------------------------
            cur.execute("""
                SELECT TABLE_NAME
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_NAME LIKE '%KIT%'
                   OR TABLE_NAME LIKE '%COMP%'
                   OR TABLE_NAME LIKE '%BOM%'
                ORDER BY TABLE_NAME
            """)
            candidate_tables = [t.TABLE_NAME for t in cur.fetchall()]

            cur.execute("""
                SELECT TABLE_NAME, COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE COLUMN_NAME LIKE '%KIT%'
                   OR COLUMN_NAME LIKE '%COMP%'
                ORDER BY TABLE_NAME, COLUMN_NAME
            """)
            candidate_columns = [
                {"table": r.TABLE_NAME, "column": r.COLUMN_NAME}
                for r in cur.fetchall()
            ]

            return jsonify({
                "ok": True,
                "item_no": item_no,
                "is_kit_parent": is_kit_parent,
                "component_table_found": False,
                "components": [],
                "message": (
                    "Kit parent detected in IM_ITEM, but component table was "
                    "not automatically identified."
                ) if is_kit_parent else "Item is not flagged as a kit parent.",
                "candidate_tables": candidate_tables,
                "candidate_columns": candidate_columns,
            })

    except Exception as exc:
        return _sql_error("Kit component lookup failed.", exc)


@app.get("/api/sql/categories")
def sql_categories():
    sql = (
        "SELECT DISTINCT CATEG_COD FROM IM_ITEM "
        "WHERE CATEG_COD IS NOT NULL AND CATEG_COD <> '' "
        "ORDER BY CATEG_COD"
    )
    try:
        with get_sql_connection() as cn:
            cur = cn.cursor()
            cur.execute(sql)
            return jsonify({"categories": [r.CATEG_COD for r in cur.fetchall()]})
    except Exception as exc:
        return _sql_error("Category lookup failed.", exc)


@app.get("/api/sql/subcategories")
def sql_subcategories():
    category = request.args.get("category", "").strip()
    sql = (
        "SELECT DISTINCT SUBCAT_COD FROM IM_ITEM "
        "WHERE SUBCAT_COD IS NOT NULL AND SUBCAT_COD <> '' "
        "AND (? = '' OR CATEG_COD = ?) "
        "ORDER BY SUBCAT_COD"
    )
    try:
        with get_sql_connection() as cn:
            cur = cn.cursor()
            cur.execute(sql, (category, category))
            return jsonify({"subcategories": [r.SUBCAT_COD for r in cur.fetchall()]})
    except Exception as exc:
        return _sql_error("Subcategory lookup failed.", exc)

# Typed routes from cp_endpoints.ENDPOINTS. Each registry row becomes a Flask
# rule with hook support (see __CntrPHooks__.py). Routes mount twice: at
# /api/cp/<guide_path> and at /<guide_path> (drop-in - change the port and
# nothing else). Unregistered paths still work through the generic mirror
# below, so the wrapper doesn't block forward compatibility.

# Methods this wrapper supports.
_PROXY_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"]


def _guide_path_to_flask(path: str) -> str:
    """`/Customer/{CustNo}/Address` -> `/Customer/<CustNo>/Address`."""
    return re.sub(r"\{(\w+)\}", r"<\1>", path)


def _slug(path: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", path).strip("_").lower() or "root"


# Upstream forwarder that handles JSON, text, and binary content types.
# cp_api_request (above) is JSON-only and stays around for the health ping.
def _cp_upstream_call(method: str, path: str, body: Any, query: dict[str, str]) -> dict[str, Any]:
    url = f"{CP_API_BASE_URL}/{path.lstrip('/')}"
    request_kwargs: dict[str, Any] = {
        "method": method,
        "url": url,
        "params": query or None,
        "auth": _cp_auth(),
        "headers": _cp_headers(),
        "verify": CP_API_VERIFY_SSL,
        "timeout": 60,
    }
    if method in ("POST", "PUT", "PATCH") and body is not None:
        # Dict / list -> JSON encode via requests; raw str / bytes -> send as-is.
        if isinstance(body, (dict, list)):
            request_kwargs["json"] = body
        else:
            request_kwargs["data"] = body

    try:
        resp = requests.request(**request_kwargs)
    except requests.RequestException as exc:
        log.warning("CP typed-route transport error: %s %s -> %s", method, path, exc)
        return {
            "status": 0,
            "body": None,
            "content_type": None,
            "headers": {},
            "transport_error": f"Transport error: {exc}",
        }

    content_type = resp.headers.get("Content-Type", "application/json")
    body_out: Any
    if "json" in content_type.lower():
        try:
            body_out = resp.json()
        except ValueError:
            body_out = resp.text
    elif content_type.startswith(("image/", "application/octet-stream", "application/pdf")):
        body_out = resp.content       # raw bytes - keep as-is
    else:
        body_out = resp.text

    return {
        "status": resp.status_code,
        "body": body_out,
        "content_type": content_type,
        "headers": dict(resp.headers),
        "transport_error": None,
    }


def _build_flask_response(ctx: dict[str, Any]) -> Response:
    body = ctx["response_body"]
    status = ctx["response_status"] or 200
    ct = ctx["response_content_type"] or "application/json"

    if isinstance(body, (dict, list)):
        resp = jsonify(body)
        resp.status_code = status
    elif isinstance(body, (bytes, bytearray)):
        resp = Response(bytes(body), status=status, content_type=ct)
    elif body is None:
        resp = Response(b"", status=status, content_type=ct)
    else:
        resp = Response(str(body), status=status, content_type=ct)

    for k, v in (ctx.get("response_headers") or {}).items():
        resp.headers[k] = v
    return resp


def _is_direct_request() -> bool:
    """True if the caller requested raw passthrough via query or header."""
    val = (request.args.get("_direct") or "").strip().lower()
    if val in {"1", "true", "yes", "on"}:
        return True
    hdr = (request.headers.get("X-CntrP-Mode") or "").strip().lower()
    return hdr == "direct"


def _run_direct(method: str, guide_path_template: str, path_params: dict[str, Any]) -> Response:
    """Hook-bypass path. Forward to NCR raw, return what it sends. Same effect
    as hitting the generic mirror, but at the typed route's URL."""
    upstream_path = guide_path_template
    for k, v in (path_params or {}).items():
        upstream_path = upstream_path.replace("{" + k + "}", str(v))

    # NCR shouldn't see our internal flag.
    query = {k: v for k, v in request.args.items() if k != "_direct"}

    body: Any = None
    if method in ("POST", "PUT", "PATCH"):
        body = request.get_json(silent=True)
        if body is None and request.data:
            try:
                body = request.data.decode("utf-8")
            except UnicodeDecodeError:
                body = request.data

    result = _cp_upstream_call(method, upstream_path, body, query)

    ctx = {
        "response_status": result["status"] or 502,
        "response_body": result["body"],
        "response_content_type": result["content_type"],
        "response_headers": {"X-CntrP-Mode": "direct"},
    }
    if not result["status"]:
        ctx["response_body"] = {
            "ok": False,
            "message": "Counterpoint API unreachable.",
            "error": result["transport_error"] or "no upstream status",
        }
    return _build_flask_response(ctx)


def _run_endpoint(name: str, method: str, guide_path: str, path_params: dict[str, Any]) -> Response:
    """Run pre-hooks, then upstream (or during-hook), then post-hooks. Direct
    mode short-circuits the whole pipeline when env-enabled and opt-in."""
    if CP_ALLOW_DIRECT_MODE and _is_direct_request():
        return _run_direct(method, guide_path, path_params)

    # Silent parse so a bad body just lands as None; hooks can decide.
    request_body: Any = None
    if method in ("POST", "PUT", "PATCH"):
        request_body = request.get_json(silent=True)
        if request_body is None and request.data:
            try:
                request_body = request.data.decode("utf-8")
            except UnicodeDecodeError:
                request_body = request.data

    ctx: dict[str, Any] = {
        "name": name,
        "method": method,
        "guide_path": guide_path,                 # template, params not yet substituted
        "guide_path_template": guide_path,
        "path_params": dict(path_params),
        "query": {k: v for k, v in request.args.items()},
        "request_body": request_body,
        "request_headers": _cp_headers(),
        "upstream_status": None,
        "upstream_body": None,
        "upstream_headers": {},
        "upstream_content_type": None,
        "response_status": None,
        "response_body": None,
        "response_headers": {},
        "response_content_type": None,
        "skip_upstream": False,
        "meta": {},
    }

    # Pre hooks ------------------------------------------------------------
    for hook in cp_endpoints.get_pre_hooks(name):
        try:
            hook(ctx)
        except Exception as exc:
            log.exception("pre-hook failed for %s", name)
            return jsonify({
                "ok": False,
                "message": f"pre-hook for {name!r} raised an exception.",
                "error": str(exc),
            }), 500
        if ctx["skip_upstream"]:
            break

    # Substitute path params into the guide path for the upstream call.
    upstream_path = ctx["guide_path_template"]
    for k, v in (ctx["path_params"] or {}).items():
        upstream_path = upstream_path.replace("{" + k + "}", str(v))
    ctx["guide_path"] = upstream_path

    # During hook (or default upstream call) ------------------------------
    if not ctx["skip_upstream"]:
        during = cp_endpoints.get_during_hook(name)
        if during:
            try:
                during(ctx)
            except Exception as exc:
                log.exception("during-hook failed for %s", name)
                return jsonify({
                    "ok": False,
                    "message": f"during-hook for {name!r} raised an exception.",
                    "error": str(exc),
                }), 500
        else:
            result = _cp_upstream_call(
                ctx["method"],
                ctx["guide_path"],
                ctx["request_body"],
                ctx["query"],
            )
            ctx["upstream_status"] = result["status"]
            ctx["upstream_body"] = result["body"]
            ctx["upstream_headers"] = result["headers"]
            ctx["upstream_content_type"] = result["content_type"]
            if result["transport_error"]:
                ctx["meta"]["transport_error"] = result["transport_error"]

    # Default response_* from upstream_* if hooks didn't supply them.
    if ctx["response_status"] is None:
        if ctx["upstream_status"]:
            ctx["response_status"] = ctx["upstream_status"]
        else:
            ctx["response_status"] = 502
            if ctx["response_body"] is None:
                ctx["response_body"] = {
                    "ok": False,
                    "message": "Counterpoint API unreachable.",
                    "error": ctx["meta"].get("transport_error", "no upstream status"),
                }
    if ctx["response_body"] is None:
        ctx["response_body"] = ctx["upstream_body"]
    if ctx["response_content_type"] is None:
        ctx["response_content_type"] = ctx["upstream_content_type"]

    # Post hooks -----------------------------------------------------------
    for hook in cp_endpoints.get_post_hooks(name):
        try:
            hook(ctx)
        except Exception as exc:
            log.exception("post-hook failed for %s", name)
            return jsonify({
                "ok": False,
                "message": f"post-hook for {name!r} raised an exception.",
                "error": str(exc),
            }), 500

    return _build_flask_response(ctx)


def _make_dispatch(guide_path: str, method_to_name: dict[str, str]):
    """Build a Flask view that dispatches by HTTP method to the right registry name."""
    def view(**path_params):
        name = method_to_name.get(request.method)
        if not name:
            return jsonify({
                "ok": False,
                "message": f"{request.method} not supported for {guide_path}.",
            }), 405
        return _run_endpoint(name, request.method, guide_path, path_params)
    view.__name__ = f"cp_dispatch_{_slug(guide_path)}"
    return view


# Paths reserved by this app - never mount a root-level CP route that would
# shadow our own UI / health / SQL / mirror routes. Capital-letter CP paths
# don't collide with any of these in practice, but the check is cheap.
_RESERVED_ROOT_PREFIXES = ("/api/", "/static/")


def _register_cp_typed_routes() -> None:
    # Group registry entries by path so we register each Flask URL once with
    # all of its supported methods (gives correct 405 semantics).
    by_path: dict[str, dict[str, str]] = {}
    for method, guide_path, name, _desc, _ak, _cp in cp_endpoints.iter_endpoints():
        by_path.setdefault(guide_path, {})[method] = name

    for guide_path, method_to_name in by_path.items():
        flask_sub = _guide_path_to_flask(guide_path)
        methods = list(method_to_name.keys())
        slug = _slug(guide_path)

        # Mount under /api/cp/ (the existing convention).
        app.add_url_rule(
            f"/api/cp{flask_sub}",
            endpoint=f"cp_typed_{slug}",
            view_func=_make_dispatch(guide_path, method_to_name),
            methods=methods,
        )
        # Mount at root for drop-in compatibility - integrators only have to
        # change the port number to point at this wrapper. Skip the rare case
        # of a guide path that would collide with our own /api/* or /static/*.
        if not any(flask_sub.startswith(p) for p in _RESERVED_ROOT_PREFIXES) and flask_sub != "/":
            app.add_url_rule(
                flask_sub,
                endpoint=f"cp_root_{slug}",
                view_func=_make_dispatch(guide_path, method_to_name),
                methods=methods,
            )


_register_cp_typed_routes()


# Storefront aggregation endpoints for webstore/ (see store_api.py). These shape
# whatever is in Counterpoint into clean JSON for the PWA and post web orders
# back as CP Documents. Kept in their own module so the generic mirror stays 1:1.
import store_api

store_api.register_store_routes(
    app,
    cp_api_request=cp_api_request,
    cp_upstream_call=_cp_upstream_call,
    get_sql_connection=get_sql_connection,
    get_existing_columns=get_existing_columns,
    safe_select=_safe_select,
    jsonable=_jsonable,
    config={
        "store_name": STORE_NAME,
        "currency": STORE_CURRENCY,
        "tax_rate": STORE_TAX_RATE,
        "default_loc_id": STORE_DEFAULT_LOC_ID,
        "default_cust_no": STORE_DEFAULT_CUST_NO,
        "promo_str_id": STORE_PROMO_STR_ID or STORE_DEFAULT_LOC_ID,
        "item_image_dir": CP_ITEM_IMAGE_DIR,
        "item_placeholder_dir": CP_ITEM_PLACEHOLDER_DIR,
        "payments_config_path": CP_PAYMENTS_CONFIG_PATH,
        "allow_item_write": CP_ALLOW_ITEM_WRITE,
        "doc_str_id": STORE_DOC_STR_ID,
        "doc_sta_id": STORE_DOC_STA_ID,
        "doc_drw_id": STORE_DOC_DRW_ID,
        "doc_usr_id": STORE_DOC_USR_ID,
        "doc_tkt_typ": STORE_DOC_TKT_TYP,
        "doc_doc_typ": STORE_DOC_DOC_TYP,
    },
)

# SMS receipts + CASL-compliant marketing texts via Twilio (see sms_api.py).
import sms_api

sms_api.register_sms_routes(
    app,
    config={
        "account_sid": TWILIO_ACCOUNT_SID,
        "auth_token": TWILIO_AUTH_TOKEN,
        "from_number": TWILIO_FROM_NUMBER,
        "messaging_service_sid": TWILIO_MESSAGING_SERVICE_SID,
        "consent_path": SMS_CONSENT_PATH,
        "quiet_start": SMS_QUIET_START,
        "quiet_end": SMS_QUIET_END,
        "store_name": STORE_NAME,
        "contact_info": SMS_CONTACT_INFO,
        "public_base_url": SMS_PUBLIC_BASE_URL,
    },
)


# Generic 1:1 mirror. Catches anything the typed registry doesn't cover so
# new NCR endpoints work before we update cp_endpoints.py.

@app.route("/api/cp/<path:subpath>", methods=_PROXY_METHODS)
def cp_proxy(subpath: str):
    """Transparent passthrough: forward method, query, body, content-type;
    return upstream status/body/content-type unchanged. We only inject auth."""
    # Raw bytes so we don't mangle non-JSON content types.
    body = request.get_data() or None
    headers = _cp_headers()
    inbound_ct = request.headers.get("Content-Type")
    if inbound_ct:
        headers["Content-Type"] = inbound_ct

    url = f"{CP_API_BASE_URL}/{subpath}"
    try:
        resp = requests.request(
            method=request.method,
            url=url,
            params=request.args,
            data=body,
            auth=_cp_auth(),
            headers=headers,
            verify=CP_API_VERIFY_SSL,
            timeout=60,
        )
    except requests.RequestException as exc:
        log.warning("CP proxy transport error: %s %s -> %s", request.method, subpath, exc)
        return jsonify({
            "ok": False,
            "message": "Counterpoint API request failed.",
            "path": subpath,
            "error": f"Transport error: {exc}",
        }), 502

    content_type = resp.headers.get("Content-Type", "application/json")
    return Response(resp.content, status=resp.status_code, content_type=content_type)


@app.route("/<path:subpath>", methods=_PROXY_METHODS)
def cp_proxy_root(subpath: str):
    """Catch-all root-level mirror. Anything not matched by a typed CP
    route or an internal /api/* path falls through to the upstream
    Counterpoint API - same behavior as /api/cp/<path>, but at the path
    callers' existing integrations already use.

    This makes the wrapper a true drop-in: point any existing CP client
    at this port and every endpoint reaches NCR by default, registered
    or not. New NCR endpoints work the day they ship; cp_endpoints.py
    only matters when you want hooks on a specific path."""
    full_path = "/" + subpath
    if any(full_path.startswith(p) for p in _RESERVED_ROOT_PREFIXES):
        return jsonify({
            "ok": False,
            "message": f"{full_path} is reserved by the wrapper, not a Counterpoint path.",
        }), 404
    return cp_proxy(subpath)


@app.get("/api/cp")
def cp_mirror_index():
    """Describe the wrapper so callers can discover what's exposed."""
    registry = [
        {
            "method": method,
            "guide_path": guide_path,
            "name": name,
            "description": desc,
            "requires_api_key": api_key,
            "requires_cp_registration": cp_reg,
            "wrapper_paths": [
                f"/api/cp{guide_path}",
                guide_path,                  # also mounted at root for drop-in
            ],
            "has_pre_hooks": bool(cp_endpoints.get_pre_hooks(name)),
            "has_during_hook": cp_endpoints.get_during_hook(name) is not None,
            "has_post_hooks": bool(cp_endpoints.get_post_hooks(name)),
        }
        for method, guide_path, name, desc, api_key, cp_reg
        in cp_endpoints.iter_endpoints()
    ]
    return jsonify({
        "ok": True,
        "message": (
            "Wraps the NCR Counterpoint API. Every endpoint is mounted at "
            "/api/cp/<path> and at /<path> (drop in, change the port). "
            "Anything not in the typed registry still falls through to "
            "NCR - either at /api/cp/<path> or at the bare /<path> root - "
            "so new NCR endpoints work the day they ship."
        ),
        "guide": "https://github.com/NCRCounterpointAPI/APIGuide",
        "base_url": CP_API_BASE_URL,
        "company_alias": CP_COMPANY_ALIAS,
        "methods": _PROXY_METHODS,
        "registry_count": len(registry),
        "registry": registry,
        "direct_mode": {
            "enabled": CP_ALLOW_DIRECT_MODE,
            "opt_in_query": "?_direct=1",
            "opt_in_header": "X-CntrP-Mode: direct",
            "description": (
                "When enabled, callers can bypass the hook pipeline per "
                "request and get the raw upstream response. Set "
                "CP_ALLOW_DIRECT_MODE=true in .env to turn it on."
            ),
        },
        "sql_extensions": [
            "/api/sql/items",
            "/api/sql/items/<item_no>",
            "/api/sql/items/<item_no>/kit-components",
            "/api/sql/kits",
            "/api/sql/categories",
            "/api/sql/subcategories",
        ],
        "store_endpoints": [
            "/api/store/config",
            "/api/store/categories",
            "/api/store/products",
            "/api/store/item-image/<item_no>",
            "/api/store/order",
        ],
    })

# Auto-load custom hooks if the user has a __CntrPHooks__.py sibling. Missing
# file is fine. Broken file (import/syntax error) bubbles up so we don't
# silently swallow the real cause.
import importlib.util as _import_util

if _import_util.find_spec("__CntrPHooks__") is not None:
    import __CntrPHooks__  # noqa: F401  side-effect import; registers hooks
    log.info("Loaded hooks from __CntrPHooks__.py")
else:
    log.info("No __CntrPHooks__.py found, running without custom hooks.")


if __name__ == "__main__":
    app.run(host=FLASK_HOST, port=FLASK_PORT, debug=FLASK_DEBUG)
