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
aren't a security boundary — if a hook MUST run (compliance redaction,
say), leave direct mode off in that env.

For caller authentication, use the wrapper API key (CNTRPORT_API_KEY in
.env). It runs in app.before_request — *before* hooks and *before* direct
mode — so an unauthenticated caller can't bypass it. Hooks are the right
place for *richer* identity logic on top of the key (mapping keys to
caller IDs for audit, requiring a stronger key on sensitive endpoints,
etc.). See the templates at the bottom of this file.

Uncomment the templates below and tweak them. Anything still commented
does nothing. Restart Flask after editing.
"""

from __future__ import annotations

import logging

import cp_endpoints

log = logging.getLogger("cntrp.hooks")


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
# on that — mapping keys to callers for audit, and requiring a stronger key
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
# # registry name from cp_endpoints.ENDPOINTS — these are just examples.
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
