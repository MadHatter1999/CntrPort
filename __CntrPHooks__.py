"""
Custom hooks for the Counterpoint API wrapper.

Drop your @cp_endpoints.pre / .during / .post decorators in this file.
app.py auto-imports it at startup, so the decorators register themselves.

Three hook kinds:
    pre(name)    runs before the upstream HTTP call. Mutate ctx however
                 you want. Set ctx["skip_upstream"] = True to short-circuit
                 and supply ctx["response_*"] yourself.
    during(name) replaces the upstream call. One per endpoint, max. The
                 hook is responsible for ctx["upstream_status"] and
                 ctx["upstream_body"].
    post(name)   runs after the upstream call (or your during-hook). Mutate
                 ctx["response_*"] to change what the caller sees.

`name` is the registry name from cp_endpoints.ENDPOINTS (third column).
Hit GET /api/cp for a live list. Pre-hooks run in registration order, then
during (if any), then post-hooks in registration order.

The ctx dict carries: name, method, guide_path (params substituted),
guide_path_template (with braces), path_params, query, request_body,
request_headers, upstream_status / _body / _headers / _content_type,
response_status / _body / _headers / _content_type (default to the
upstream values), skip_upstream, meta (free-form scratch). Everything's
mutable.

One gotcha. If CP_ALLOW_DIRECT_MODE=true in .env, callers can bypass this
whole file per-request with ?_direct=1 or X-CntrP-Mode: direct. So hooks
aren't a security boundary - if a hook MUST run (compliance redaction,
say), leave direct mode off in that env.

For caller authentication, use the wrapper API key (CNTRPORT_API_KEY in
.env). It runs in app.before_request - *before* hooks and *before* direct
mode - so an unauthenticated caller can't bypass it. Hooks are the right
place for *richer* identity logic on top of the key (mapping keys to
caller IDs for audit, requiring a stronger key on sensitive endpoints,
etc.). See the templates at the bottom of this file.

Uncomment the templates below and tweak them. Anything still commented
does nothing. Restart Flask after editing.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

import cp_endpoints

log = logging.getLogger("cntrp.hooks")


# ===========================================================================
# LIVE HOOKS - currently active in production
# ===========================================================================

# --- Bank of Canada FX enrichment on get_item -------------------------------
# Fires after CP returns an item, calls the Bank of Canada Valet API for the
# latest published FX rates against CAD, and stamps converted prices onto the
# response. Rates are cached for 6 hours (BoC publishes once per business day
# anyway). Fails soft: if BoC is unreachable and the cache is empty, the item
# is returned unchanged.

# Currencies BoC publishes against CAD. Series naming is FX<CCY>CAD.
_BOC_CURRENCIES = (
    "USD", "EUR", "GBP", "AUD", "BRL", "CHF", "CNY", "HKD", "IDR", "INR",
    "JPY", "KRW", "MXN", "MYR", "NOK", "NZD", "PEN", "RUB", "SAR", "SEK",
    "SGD", "THB", "TRY", "TWD", "VND", "ZAR",
)

# CP item price fields we'll convert if present and numeric. Items that
# don't carry a given field are skipped silently. Covers the standard
# price tiers (PRC_1..3, REG_PRC), cost (LST_COST), alt-unit prices
# (ALT_1_REG_PRC for case/pack pricing), and preferred-unit prices.
_BOC_PRICE_FIELDS = (
    "PRC_1", "PRC_2", "PRC_3", "REG_PRC", "LST_COST",
    "ALT_1_REG_PRC", "PREF_UNIT_PRC_1", "PREF_UNIT_REG_PRC",
)

_BOC_CACHE: dict[str, Any] = {"rates": None, "date": None, "ts": 0.0}
_BOC_TTL = 6 * 3600  # 6 hours


def _fetch_boc_rates() -> tuple[dict[str, float] | None, str | None]:
    """Return (rates_by_ccy, observation_date).

    Each value in `rates_by_ccy` is the number of CAD per 1 unit of the
    foreign currency (BoC's published convention for FX<CCY>CAD series).
    To convert a CAD price to a foreign currency: foreign = cad / rate.

    Cached for _BOC_TTL seconds. On transport / parse failure, returns
    whatever is in the cache (possibly None), so the hook can fail soft.
    """
    now = time.time()
    if (
        _BOC_CACHE["rates"] is not None
        and now - _BOC_CACHE["ts"] < _BOC_TTL
    ):
        return _BOC_CACHE["rates"], _BOC_CACHE["date"]

    # BoC accepts comma-separated series in one URL; one HTTP round trip for
    # all ~26 currencies.
    series = ",".join(f"FX{c}CAD" for c in _BOC_CURRENCIES)
    url = f"https://www.bankofcanada.ca/valet/observations/{series}/json"
    try:
        r = requests.get(url, params={"recent": 1}, timeout=8)
        if r.status_code != 200:
            log.warning("BoC Valet returned HTTP %s; serving cached rates.",
                        r.status_code)
            return _BOC_CACHE["rates"], _BOC_CACHE["date"]
        data = r.json()
        observations = data.get("observations") or []
        if not observations:
            return _BOC_CACHE["rates"], _BOC_CACHE["date"]
        obs = observations[0]
        rates: dict[str, float] = {}
        for ccy in _BOC_CURRENCIES:
            entry = obs.get(f"FX{ccy}CAD")
            if isinstance(entry, dict):
                try:
                    rates[ccy] = float(entry.get("v"))
                except (TypeError, ValueError):
                    continue
        if rates:
            _BOC_CACHE["rates"] = rates
            _BOC_CACHE["date"]  = obs.get("d")
            _BOC_CACHE["ts"]    = now
            log.info("BoC FX rates refreshed for %s (%d currencies).",
                     _BOC_CACHE["date"], len(rates))
            return rates, _BOC_CACHE["date"]
    except (requests.RequestException, ValueError) as exc:
        log.warning("BoC Valet fetch failed: %s", exc)

    return _BOC_CACHE["rates"], _BOC_CACHE["date"]


@cp_endpoints.post("get_item")
def add_currency_conversions(ctx):
    """Stamp converted prices on every /Item/<ItemNo> response.

    CP returns the item wrapped: {"ErrorCode": "SUCCESS", "IM_ITEM": {...}}.
    We drill into IM_ITEM, read each numeric price field, and stamp:
        CURRENCY_CONVERSIONS - {field: {ccy: amount}} for each numeric price
        FX_SOURCE            - 'BankOfCanada Valet'
        FX_RATES_DATE        - the BoC observation date the rates came from
    onto IM_ITEM so the enrichment sits next to the original prices.

    Falls back to the top-level body for older CP responses that aren't
    wrapped in IM_ITEM.
    """
    body = ctx["response_body"]
    if not isinstance(body, dict):
        return  # binary / error response - nothing to enrich

    # CP wraps the item inside IM_ITEM. Use that if present, otherwise
    # treat the body itself as the item (covers legacy / un-wrapped shapes).
    item = body.get("IM_ITEM")
    if not isinstance(item, dict):
        item = body

    rates, rates_date = _fetch_boc_rates()
    if not rates:
        return  # BoC down and cache empty - return item unchanged

    conversions: dict[str, dict[str, float]] = {}
    for field in _BOC_PRICE_FIELDS:
        cad_price = item.get(field)
        if not isinstance(cad_price, (int, float)):
            continue
        per_currency = {"CAD": round(float(cad_price), 2)}
        for ccy, rate in rates.items():
            if rate > 0:
                per_currency[ccy] = round(float(cad_price) / rate, 2)
        conversions[field] = per_currency

    if conversions:
        item["CURRENCY_CONVERSIONS"] = conversions
        item["FX_SOURCE"] = "BankOfCanada Valet"
        item["FX_RATES_DATE"] = rates_date


# ===========================================================================
# TEMPLATES - uncomment and tweak. Anything still commented does nothing.
# ===========================================================================


# --- pre-hook templates -----------------------------------------------------

# Stamp a default USR_ID on every order:
#
# @cp_endpoints.pre("post_document")
# def stamp_default_user(ctx):
#     body = ctx["request_body"] or {}
#     body.setdefault("PS_DOC_HDR", {}).setdefault("USR_ID", "API")
#     ctx["request_body"] = body


# Reject blank path params before we hit NCR:
#
# @cp_endpoints.pre("get_customer")
# def require_cust_no(ctx):
#     cust_no = (ctx["path_params"].get("CustNo") or "").strip()
#     if not cust_no:
#         ctx["skip_upstream"] = True
#         ctx["response_status"] = 400
#         ctx["response_body"] = {"ok": False, "message": "CustNo is required."}


# Force a default query param:
#
# @cp_endpoints.pre("get_items_by_location")
# def default_limit(ctx):
#     ctx["query"].setdefault("limit", "500")


# --- during-hook templates --------------------------------------------------
# One per endpoint. Replaces the upstream call. Pre and post still run.

# Stub SystemInfo in staging:
#
# @cp_endpoints.during("get_system_info")
# def stub_system_info(ctx):
#     ctx["upstream_status"] = 200
#     ctx["upstream_body"] = {"stub": True, "env": "staging"}


# Route InventoryLocations to your own service:
#
# import requests
# @cp_endpoints.during("get_inventory_locations")
# def from_warehouse(ctx):
#     r = requests.get("http://warehouse.internal/locations", timeout=5)
#     ctx["upstream_status"] = r.status_code
#     ctx["upstream_body"] = r.json()


# --- post-hook templates ----------------------------------------------------

# Drop sensitive fields:
#
# @cp_endpoints.post("get_customer")
# def redact_sensitive(ctx):
#     body = ctx["response_body"]
#     if isinstance(body, dict):
#         for k in ("AR_CRD_LIM", "AR_ACCT_OPN_DT", "INTERNAL_NOTES"):
#             body.pop(k, None)


# Audit every write:
#
# _AUDITED = (
#     "post_document",
#     "post_document_lines",
#     "post_document_payments",
#     "post_customer",
#     "patch_customer",
#     "delete_customer_address",
# )
# for _name in _AUDITED:
#     @cp_endpoints.post(_name)
#     def _audit(ctx, _name=_name):
#         log.info("AUDIT %s %s -> %s", ctx["method"], ctx["guide_path"], ctx["response_status"])


# Wrap upstream errors in your own envelope:
#
# @cp_endpoints.post("post_document")
# def standard_error_envelope(ctx):
#     status = ctx["response_status"] or 500
#     if status >= 400:
#         body = ctx["response_body"] if isinstance(ctx["response_body"], dict) else {}
#         ctx["response_body"] = {
#             "ok": False,
#             "status": status,
#             "error": body.get("ErrorCode") or body.get("Message") or "Unknown error",
#             "counterpoint_response": ctx["response_body"],
#         }


# --- combined pre + post: in-memory TTL cache for an idempotent GET ---------

# import time
# _STORE_CACHE: dict[tuple, tuple[float, object]] = {}
# _STORE_TTL = 60  # seconds
#
# def _store_key(ctx):
#     return (ctx["name"], tuple(sorted(ctx["path_params"].items())))
#
# @cp_endpoints.pre("get_store")
# def store_cache_lookup(ctx):
#     hit = _STORE_CACHE.get(_store_key(ctx))
#     if hit and time.time() - hit[0] < _STORE_TTL:
#         ctx["skip_upstream"] = True
#         ctx["response_status"] = 200
#         ctx["response_body"] = hit[1]
#         ctx["meta"]["cache_hit"] = True
#
# @cp_endpoints.post("get_store")
# def store_cache_fill(ctx):
#     if ctx["meta"].get("cache_hit"):
#         return
#     if ctx["response_status"] == 200:
#         _STORE_CACHE[_store_key(ctx)] = (time.time(), ctx["response_body"])


# --- wrapper API-key extensions --------------------------------------------
# The wrapper API-key gate (CNTRPORT_API_KEY in .env, default header
# X-API-Key) runs in app.before_request, so by the time any hook fires the
# caller is already authenticated. These templates show patterns that build
# on that - mapping keys to callers for audit, and requiring a stronger key
# on destructive endpoints.


# Map known keys -> caller identity, stamp it on every request for audit.
# Useful when several integrations share the wrapper (POS, eCom, ops tools)
# and you want logs to say *who* did what, not just "someone with a key".
#
# import os
# from flask import request
#
# _KEY_TO_CALLER = {
#     os.getenv("CNTRPORT_KEY_POS",   ""): "pos",
#     os.getenv("CNTRPORT_KEY_ECOM",  ""): "ecom",
#     os.getenv("CNTRPORT_KEY_OPS",   ""): "ops-dashboard",
# }
# _KEY_TO_CALLER.pop("", None)  # drop unset env vars so blank != match
#
# def _identify_caller():
#     header = os.getenv("CNTRPORT_API_KEY_HEADER", "X-API-Key")
#     return _KEY_TO_CALLER.get(request.headers.get(header, ""), "unknown")
#
# # Stamp the caller on a representative set of write endpoints. Use any
# # registry name from cp_endpoints.ENDPOINTS - these are just examples.
# for _name in ("post_document", "post_customer", "patch_customer",
#               "post_document_payments"):
#     @cp_endpoints.pre(_name)
#     def _stamp_caller(ctx, _name=_name):
#         ctx["meta"]["caller"] = _identify_caller()
#
#     @cp_endpoints.post(_name)
#     def _log_caller(ctx, _name=_name):
#         log.info("AUDIT caller=%s %s %s -> %s",
#                  ctx["meta"].get("caller", "unknown"),
#                  ctx["method"], ctx["guide_path"], ctx["response_status"])


# Require a second, stronger key on destructive / admin endpoints. The
# wrapper key gets a caller in the door; the admin key gates the dangerous
# verbs. Set CNTRPORT_ADMIN_KEY in .env and send it alongside X-API-Key.
#
# import os, secrets
# from flask import request
#
# _ADMIN_ONLY = (
#     "delete_admin_user",
#     "delete_company_admin",
#     "delete_database",
#     "delete_role",
#     "delete_user_roles",
# )
#
# def _require_admin_key(ctx):
#     expected = os.getenv("CNTRPORT_ADMIN_KEY", "")
#     supplied = request.headers.get("X-Admin-Key", "")
#     if not expected or not supplied or not secrets.compare_digest(supplied, expected):
#         ctx["skip_upstream"] = True
#         ctx["response_status"] = 403
#         ctx["response_body"] = {
#             "ok": False,
#             "message": "X-Admin-Key required for this endpoint.",
#         }
#
# for _name in _ADMIN_ONLY:
#     cp_endpoints.pre(_name)(_require_admin_key)
