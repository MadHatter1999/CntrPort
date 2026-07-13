"""
Twilio SMS for the web store: order receipts + opted-in marketing texts.

Mounted by app.py via register_sms_routes(app, config=...). Kept separate from
store_api.py so the Counterpoint concern and the messaging concern never mix.

Compliance posture (Canada)
---------------------------
CASL (S.C. 2010, c. 23 - Canada's Anti-Spam Legislation):
  * Marketing texts are commercial electronic messages (CEMs). They are only
    ever sent to numbers with recorded EXPRESS consent: the consent ledger
    stores who opted in, when, from where, and the exact consent wording shown
    (CASL s.13 puts the burden of proving consent on the sender).
  * The opt-in is never pre-checked in the storefront and is not a condition
    of purchase.
  * Every marketing message identifies the store and carries an unsubscribe
    notice (STOP / ARRET), per CASL s.6(2). Unsubscribes take effect
    immediately (CASL allows up to 10 business days).
  * Order receipts are transactional messages (CASL s.6(6) exempts them from
    the consent requirement) and are only sent when the shopper asks for one
    at checkout; they still identify the store and honour STOP.
  * Campaigns only send inside a quiet-hours window (default 9am-9pm server
    time) so marketing never lands overnight.

PCI DSS:
  * Messages never contain cardholder data. This module only ever receives
    order facts (reference, item names/quantities, totals). Card entry stays
    in the browser; no PAN/expiry/CVC ever reaches these endpoints, and
    nothing here should ever echo payment details into a message body.

Twilio is called over its plain REST API with `requests` (no SDK dependency):
POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json.
The inbound webhook (STOP/ARRET handling) is authenticated by validating
X-Twilio-Signature instead of the wrapper API key, since Twilio cannot send
custom headers.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import threading
from datetime import datetime, timezone
from typing import Any

import requests
from flask import Response, jsonify, request

log = logging.getLogger("cntrport.sms")

TWILIO_API = "https://api.twilio.com/2010-04-01"

# Opt-out keywords: Twilio's standard English set plus ARRET (CASL is a
# bilingual statute; NANP French-language campaigns conventionally use ARRET).
OPT_OUT_KEYWORDS = {"stop", "stopall", "unsubscribe", "cancel", "end", "quit", "arret", "arrêt"}
# Keywords Twilio's built-in opt-out handling already confirms + blocks for us.
# For these we record the opt-out silently; for the rest (French) we confirm.
TWILIO_AUTO_OPT_OUT = {"stop", "stopall", "unsubscribe", "cancel", "end", "quit"}
OPT_IN_KEYWORDS = {"start", "unstop", "yes", "oui"}

# Twilio error 21610: recipient has replied STOP to this sender before.
TWILIO_ERR_BLOCKED = 21610


# ── pure helpers (unit-testable, no Flask/network) ──────────────────────────

def normalize_phone(raw: Any, default_country: str = "1") -> str | None:
    """Normalize a user-entered phone number to E.164, defaulting to Canada/US
    (+1) for bare 10-digit numbers. Returns None when it can't be a real
    number - callers must treat that as a validation failure, never send."""
    if not raw:
        return None
    s = str(raw).strip()
    plus = s.startswith("+")
    digits = re.sub(r"\D", "", s)
    if not digits:
        return None
    if plus:
        return "+" + digits if 8 <= len(digits) <= 15 else None
    if len(digits) == 10:
        return f"+{default_country}{digits}"
    if len(digits) == 11 and digits.startswith(default_country):
        return "+" + digits
    return None


def _keyword(body: Any) -> str:
    return str(body or "").strip().lower()


def is_opt_out(body: Any) -> bool:
    return _keyword(body) in OPT_OUT_KEYWORDS


def is_opt_in(body: Any) -> bool:
    return _keyword(body) in OPT_IN_KEYWORDS


def within_send_window(now: datetime, start_hour: int, end_hour: int) -> bool:
    """True when `now` falls inside the allowed marketing window
    [start_hour, end_hour). A window of 0..24 disables the guard."""
    return start_hour <= now.hour < end_hour


def marketing_message(store: str, message: str, contact: str = "") -> str:
    """Final CEM body: sender identification up front (CASL s.6(2)(a)),
    optional contact info, and the bilingual unsubscribe notice (s.6(2)(c))."""
    parts = [f"{store}: {message.strip()}"]
    if contact:
        parts.append(contact)
    parts.append("Reply STOP to unsubscribe / Repondez ARRET pour vous desabonner.")
    return "\n".join(parts)


def receipt_message(
    store: str,
    ref: str,
    items: list[dict[str, Any]],
    total: float,
    fulfillment: str = "",
    location: str = "",
    max_item_lines: int = 4,
) -> str:
    """Compact order receipt. Order facts ONLY - never any payment/card data
    (PCI: cardholder data must not appear in an SMS)."""
    lines = [f"{store} receipt {ref}".strip()]
    for it in items[:max_item_lines]:
        name = str(it.get("name") or it.get("id") or "").strip()
        qty = it.get("qty") or 1
        if name:
            lines.append(f"{qty}x {name}")
    extra = len(items) - max_item_lines
    if extra > 0:
        lines.append(f"+{extra} more item{'s' if extra > 1 else ''}")
    lines.append(f"Total ${float(total):.2f}")
    if fulfillment == "pickup" and location:
        lines.append(f"Pickup: {location}")
    elif fulfillment == "shipping":
        lines.append("Your order will be delivered.")
    lines.append("Reply STOP to opt out of texts.")
    return "\n".join(lines)


def validate_twilio_signature(auth_token: str, url: str, params: dict[str, str], signature: str) -> bool:
    """Twilio request-signing check: HMAC-SHA1 over the full URL plus the
    POST params concatenated key+value in sorted-key order, base64-encoded.
    https://www.twilio.com/docs/usage/security#validating-requests"""
    if not auth_token or not signature:
        return False
    payload = url + "".join(k + params[k] for k in sorted(params))
    digest = hmac.new(auth_token.encode(), payload.encode("utf-8"), hashlib.sha1).digest()
    return hmac.compare_digest(base64.b64encode(digest).decode(), signature)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── routes ───────────────────────────────────────────────────────────────────

def register_sms_routes(app, *, config: dict[str, Any]) -> None:
    """Attach the SMS routes. `config` keys:
      account_sid / auth_token / from_number / messaging_service_sid  (Twilio)
      consent_path   JSON consent ledger location (CASL proof-of-consent)
      quiet_start / quiet_end   marketing send window, hours 0-24
      store_name     sender identification used in every message
      contact_info   optional CASL contact line (website / phone)
      public_base_url  optional external URL base for webhook signature checks
    """

    _lock = threading.Lock()

    def _enabled() -> bool:
        return bool(
            config.get("account_sid")
            and config.get("auth_token")
            and (config.get("from_number") or config.get("messaging_service_sid"))
        )

    def _store_name() -> str:
        return (config.get("store_name") or "").strip() or "Web Store"

    def _disabled_response():
        return jsonify({
            "ok": False, "disabled": True,
            "message": "SMS is not configured (set TWILIO_ACCOUNT_SID, "
                       "TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER).",
        }), 200

    # ── consent ledger (JSON on the server; CASL s.13 proof of consent) ──
    def _ledger_path() -> str:
        return config.get("consent_path") or ""

    def _load_ledger() -> dict[str, Any]:
        path = _ledger_path()
        if path and os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                if isinstance(data, dict):
                    data.setdefault("subscribers", {})
                    data.setdefault("campaigns", [])
                    return data
            except (OSError, ValueError) as exc:  # pragma: no cover
                log.warning("sms consent ledger read failed: %s", exc)
        return {"subscribers": {}, "campaigns": []}

    def _save_ledger(data: dict[str, Any]) -> bool:
        path = _ledger_path()
        if not path:
            return False
        try:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=1)
            return True
        except OSError as exc:  # pragma: no cover
            log.warning("sms consent ledger write failed: %s", exc)
            return False

    def _record_event(sub: dict[str, Any], event: str, detail: str) -> None:
        sub.setdefault("history", []).append({"at": _utcnow_iso(), "event": event, "detail": detail})

    def _subscribe(phone: str, name: str, consent_text: str, source: str) -> None:
        with _lock:
            data = _load_ledger()
            sub = data["subscribers"].get(phone) or {}
            sub.update({
                "name": name or sub.get("name", ""),
                "consentAt": _utcnow_iso(),
                # The exact wording the person agreed to - this is the CASL
                # proof-of-consent record, keep it verbatim.
                "consentText": consent_text or sub.get("consentText", ""),
                "source": source,
                "optedOut": False,
                "optOutAt": None,
            })
            _record_event(sub, "subscribe", source)
            data["subscribers"][phone] = sub
            _save_ledger(data)

    def _unsubscribe(phone: str, source: str) -> bool:
        """Mark opted out. Returns False when the number was never on file."""
        with _lock:
            data = _load_ledger()
            sub = data["subscribers"].get(phone)
            if not sub:
                return False
            sub["optedOut"] = True
            sub["optOutAt"] = _utcnow_iso()
            _record_event(sub, "unsubscribe", source)
            _save_ledger(data)
            return True

    # ── Twilio send ───────────────────────────────────────────────────────
    def _twilio_send(to: str, body: str) -> tuple[bool, str, str]:
        """Send one SMS. Returns (ok, message_sid, error). Never raises."""
        payload = {"To": to, "Body": body}
        if config.get("messaging_service_sid"):
            payload["MessagingServiceSid"] = config["messaging_service_sid"]
        else:
            payload["From"] = config.get("from_number", "")
        try:
            r = requests.post(
                f"{TWILIO_API}/Accounts/{config['account_sid']}/Messages.json",
                data=payload,
                auth=(config["account_sid"], config["auth_token"]),
                timeout=15,
            )
            try:
                rb = r.json()
            except ValueError:
                rb = {}
            if r.status_code in (200, 201):
                return True, str(rb.get("sid") or ""), ""
            code = rb.get("code")
            msg = str(rb.get("message") or f"Twilio HTTP {r.status_code}")
            if code == TWILIO_ERR_BLOCKED:
                msg = "Recipient has opted out of texts from this number (they can reply START to re-enable)."
            log.warning("twilio send to %s failed: %s %s", to, code, msg)
            return False, "", msg
        except requests.RequestException as exc:  # pragma: no cover
            log.warning("twilio send to %s raised: %s", to, exc)
            return False, "", f"network error: {exc}"

    # ── status (secret-free; the storefront uses it to show/hide opt-ins) ──
    @app.get("/api/store/sms/status")
    def sms_status():
        return jsonify({
            "enabled": _enabled(),
            "fromNumber": config.get("from_number") or "",
            "quietStart": config.get("quiet_start", 9),
            "quietEnd": config.get("quiet_end", 21),
        })

    # ── transactional receipt ─────────────────────────────────────────────
    @app.post("/api/store/sms/receipt")
    def sms_receipt():
        if not _enabled():
            return _disabled_response()
        body = request.get_json(silent=True) or {}
        phone = normalize_phone(body.get("phone"))
        if not phone:
            return jsonify({"ok": False, "message": "Invalid phone number."}), 400
        ref = str(body.get("ref") or "").strip()
        if not ref:
            return jsonify({"ok": False, "message": "Order ref required."}), 400
        items = body.get("items") if isinstance(body.get("items"), list) else []
        try:
            total = float(body.get("total") or 0)
        except (TypeError, ValueError):
            total = 0.0
        text = receipt_message(
            _store_name(), ref, items, total,
            fulfillment=str(body.get("fulfillment") or ""),
            location=str(body.get("store") or "").strip(),
        )
        ok, sid, err = _twilio_send(phone, text)
        return jsonify({"ok": ok, "sid": sid, "message": err})

    # ── marketing consent (CASL express opt-in / opt-out) ─────────────────
    @app.post("/api/store/sms/marketing/subscribe")
    def sms_subscribe():
        body = request.get_json(silent=True) or {}
        phone = normalize_phone(body.get("phone"))
        if not phone:
            return jsonify({"ok": False, "message": "Invalid phone number."}), 400
        _subscribe(
            phone,
            name=str(body.get("name") or "").strip(),
            consent_text=str(body.get("consentText") or "").strip(),
            source=str(body.get("source") or "checkout").strip(),
        )
        # Welcome text (best-effort): confirms the subscription and restates
        # the sender + unsubscribe mechanism, so the very first CEM already
        # meets CASL's identification requirements.
        if _enabled():
            welcome = marketing_message(
                _store_name(),
                "You're subscribed to offers and promotions by text. Msg & data rates may apply.",
                contact=str(config.get("contact_info") or ""),
            )
            _twilio_send(phone, welcome)
        return jsonify({"ok": True, "phone": phone})

    @app.post("/api/store/sms/marketing/unsubscribe")
    def sms_unsubscribe():
        body = request.get_json(silent=True) or {}
        phone = normalize_phone(body.get("phone"))
        if not phone:
            return jsonify({"ok": False, "message": "Invalid phone number."}), 400
        found = _unsubscribe(phone, source=str(body.get("source") or "admin"))
        return jsonify({"ok": True, "found": found, "phone": phone})

    # ── admin: subscriber list + campaign history ──────────────────────────
    @app.get("/api/store/sms/subscribers")
    def sms_subscribers():
        data = _load_ledger()
        subs = [
            {
                "phone": phone,
                "name": s.get("name", ""),
                "consentAt": s.get("consentAt", ""),
                "consentText": s.get("consentText", ""),
                "source": s.get("source", ""),
                "optedOut": bool(s.get("optedOut")),
                "optOutAt": s.get("optOutAt"),
            }
            for phone, s in sorted(data["subscribers"].items())
        ]
        active = sum(1 for s in subs if not s["optedOut"])
        return jsonify({
            "ok": True,
            "enabled": _enabled(),
            "subscribers": subs,
            "counts": {"active": active, "optedOut": len(subs) - active},
            "campaigns": data["campaigns"][-20:][::-1],
        })

    # ── admin: send a marketing campaign to everyone opted in ─────────────
    @app.post("/api/store/sms/campaign")
    def sms_campaign():
        if not _enabled():
            return _disabled_response()
        body = request.get_json(silent=True) or {}
        message = str(body.get("message") or "").strip()
        if not message:
            return jsonify({"ok": False, "message": "Message is empty."}), 400
        if len(message) > 640:
            return jsonify({"ok": False, "message": "Message too long (max 640 characters)."}), 400

        # Quiet hours: marketing must not land overnight. Receipts are exempt.
        start = int(config.get("quiet_start", 9))
        end = int(config.get("quiet_end", 21))
        if not within_send_window(datetime.now(), start, end):
            return jsonify({
                "ok": False, "quietHours": True,
                "message": f"Outside the send window ({start:02d}:00-{end:02d}:00). "
                           "Marketing texts only go out during the day.",
            }), 200

        text = marketing_message(_store_name(), message, contact=str(config.get("contact_info") or ""))

        data = _load_ledger()
        # Express consent only: never send to opted-out or never-subscribed
        # numbers, no matter what the caller asks for (CASL s.6(1)(a)).
        targets = [p for p, s in data["subscribers"].items() if not s.get("optedOut")]
        if not targets:
            return jsonify({"ok": False, "message": "No opted-in subscribers to send to."}), 200

        results: list[dict[str, Any]] = []
        sent = failed = 0
        for phone in targets:
            ok, sid, err = _twilio_send(phone, text)
            results.append({"phone": phone, "ok": ok, "error": err})
            if ok:
                sent += 1
            else:
                failed += 1
                # A 21610-style block means they opted out at the carrier level
                # but our ledger missed it - reconcile so we never retry them.
                if "opted out" in err.lower():
                    _unsubscribe(phone, source="carrier-block")

        with _lock:
            data = _load_ledger()
            data["campaigns"].append({
                "at": _utcnow_iso(),
                "message": message,
                "body": text,
                "sent": sent,
                "failed": failed,
                "results": results,
            })
            _save_ledger(data)

        log.info("sms campaign: sent=%d failed=%d of %d", sent, failed, len(targets))
        return jsonify({"ok": failed == 0, "sent": sent, "failed": failed,
                        "total": len(targets), "results": results})

    # ── Twilio inbound webhook (STOP / ARRET / START) ──────────────────────
    # Auth: X-Twilio-Signature (validated below) instead of the wrapper API
    # key - Twilio cannot send custom headers. app.py exempts this exact path
    # from the key gate for that reason.
    @app.post("/api/store/sms/inbound")
    def sms_inbound():
        params = {k: v for k, v in request.form.items()}
        base = str(config.get("public_base_url") or "").rstrip("/")
        url = (base + request.path) if base else request.url
        sig = request.headers.get("X-Twilio-Signature", "")
        if not validate_twilio_signature(str(config.get("auth_token") or ""), url, params, sig):
            log.warning("sms inbound: rejected (bad Twilio signature) from %s", request.remote_addr)
            return jsonify({"ok": False, "message": "Invalid Twilio signature."}), 403

        frm = normalize_phone(params.get("From"))
        kw = _keyword(params.get("Body"))
        reply = ""
        if frm and is_opt_out(kw):
            _unsubscribe(frm, source="sms")
            log.info("sms inbound: %s opted out (%s)", frm, kw)
            # Twilio auto-confirms its own English STOP keywords; only confirm
            # the ones it doesn't handle (ARRET) so nobody gets two replies.
            if kw not in TWILIO_AUTO_OPT_OUT:
                reply = "Vous etes desabonne des textos de " + _store_name() + ". / You are unsubscribed."
        elif frm and is_opt_in(kw):
            with _lock:
                data = _load_ledger()
                sub = data["subscribers"].get(frm)
                if sub:
                    sub["optedOut"] = False
                    sub["optOutAt"] = None
                    _record_event(sub, "resubscribe", "sms")
                    _save_ledger(data)
            log.info("sms inbound: %s opted back in (%s)", frm, kw)

        body = f"<Message>{reply}</Message>" if reply else ""
        return Response(
            f'<?xml version="1.0" encoding="UTF-8"?><Response>{body}</Response>',
            content_type="application/xml",
        )
