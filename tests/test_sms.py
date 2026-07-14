"""
Unit tests for sms_api's pure helpers (no Flask, no network, no Twilio).

These cover the compliance-critical logic: phone normalization (never text a
malformed number), STOP/ARRET keyword handling (CASL unsubscribe), the
marketing footer (CASL sender identification + unsubscribe notice), the
receipt composer (order facts only - no card data), and the quiet-hours
window (no overnight marketing).
"""
from __future__ import annotations

from datetime import datetime

import sms_api


# ── phone normalization ──────────────────────────────────────────────────────

def test_normalize_bare_ten_digits_defaults_to_canada():
    assert sms_api.normalize_phone("9025551234") == "+19025551234"


def test_normalize_formatted_number():
    assert sms_api.normalize_phone("(902) 555-1234") == "+19025551234"


def test_normalize_eleven_digits_with_country():
    assert sms_api.normalize_phone("1 902 555 1234") == "+19025551234"


def test_normalize_e164_passthrough():
    assert sms_api.normalize_phone("+19025551234") == "+19025551234"
    assert sms_api.normalize_phone("+447911123456") == "+447911123456"


def test_normalize_rejects_garbage():
    assert sms_api.normalize_phone("") is None
    assert sms_api.normalize_phone(None) is None
    assert sms_api.normalize_phone("hello") is None
    assert sms_api.normalize_phone("12345") is None
    assert sms_api.normalize_phone("+1") is None


# ── opt-out / opt-in keywords (CASL unsubscribe, bilingual) ──────────────────

def test_opt_out_keywords():
    for kw in ("STOP", "stop", " Stop ", "UNSUBSCRIBE", "ARRET", "arrêt", "quit"):
        assert sms_api.is_opt_out(kw), kw


def test_opt_in_keywords():
    for kw in ("START", "yes", "OUI", "unstop"):
        assert sms_api.is_opt_in(kw), kw


def test_ordinary_reply_is_neither():
    assert not sms_api.is_opt_out("thanks!")
    assert not sms_api.is_opt_in("thanks!")


# ── marketing footer (CASL s.6(2): identify sender + unsubscribe) ───────────

def test_marketing_message_identifies_sender_and_unsubscribe():
    body = sms_api.marketing_message("Bishops Cellar", "15% off this weekend.")
    assert body.startswith("Bishops Cellar: 15% off this weekend.")
    assert "STOP" in body
    assert "ARRET" in body


def test_marketing_message_includes_contact_when_given():
    body = sms_api.marketing_message("Store", "Hi.", contact="store.example.com")
    assert "store.example.com" in body


# ── receipt composer (PCI: order facts only) ─────────────────────────────────

def test_receipt_message_contents():
    items = [{"name": "Chardonnay", "qty": 2}, {"name": "Riesling", "qty": 1}]
    body = sms_api.receipt_message(
        "Bishops Cellar", "WEB-1042", items, 42.5,
        fulfillment="pickup", location="Waterfront",
    )
    assert "Bishops Cellar receipt WEB-1042" in body
    assert "2x Chardonnay" in body
    assert "Total $42.50" in body
    assert "Pickup: Waterfront" in body
    assert "STOP" in body


def test_receipt_message_truncates_long_orders():
    items = [{"name": f"Item {i}", "qty": 1} for i in range(9)]
    body = sms_api.receipt_message("S", "WEB-1", items, 9.0)
    assert "+5 more items" in body
    assert "Item 8" not in body


# ── quiet hours (no overnight marketing) ─────────────────────────────────────

def test_quiet_hours_window():
    mk = lambda h: datetime(2026, 7, 13, h, 30)
    assert not sms_api.within_send_window(mk(8), 9, 21)
    assert sms_api.within_send_window(mk(9), 9, 21)
    assert sms_api.within_send_window(mk(20), 9, 21)
    assert not sms_api.within_send_window(mk(21), 9, 21)
    assert not sms_api.within_send_window(mk(3), 9, 21)


# ── email helpers (SendGrid channel) ─────────────────────────────────────────

def test_normalize_email():
    assert sms_api.normalize_email(" Jane@Example.COM ") == "jane@example.com"
    assert sms_api.normalize_email("not-an-email") is None
    assert sms_api.normalize_email("") is None
    assert sms_api.normalize_email(None) is None
    assert sms_api.normalize_email("a@b") is None


def test_email_unsub_token_is_per_address():
    a = sms_api.email_unsub_token("secret", "a@example.com")
    b = sms_api.email_unsub_token("secret", "b@example.com")
    assert a != b
    assert a == sms_api.email_unsub_token("secret", "a@example.com")
    assert a != sms_api.email_unsub_token("other-secret", "a@example.com")


def test_email_marketing_bodies_casl_footer():
    text, html_body = sms_api.email_marketing_bodies(
        "Bishops Cellar", "15% off this weekend.",
        contact="bishopscellar.com",
        address="123 Water St, Halifax NS",
        unsub_url="https://shop.example.com/api/store/email/unsubscribe?e=a%40b.com&t=tok",
    )
    for body in (text, html_body):
        assert "Bishops Cellar" in body
        assert "123 Water St" in body
        assert "bishopscellar.com" in body
    assert "Unsubscribe: https://" in text
    assert 'href="https://shop.example.com' in html_body


def test_email_receipt_bodies():
    subject, text = sms_api.email_receipt_bodies(
        "Bishops Cellar", "WEB-1042",
        [{"name": "Chardonnay", "qty": 2}], 42.5,
        fulfillment="pickup", location="Waterfront",
    )
    assert subject == "Bishops Cellar receipt WEB-1042"
    assert "2x Chardonnay" in text
    assert "Total $42.50" in text
    assert "Waterfront" in text


# ── Twilio signature validation ──────────────────────────────────────────────

def test_twilio_signature_roundtrip():
    # Signature computed exactly the way Twilio documents it; validate both the
    # matching and non-matching cases.
    import base64
    import hashlib
    import hmac

    token = "test_auth_token"
    url = "https://shop.example.com/api/store/sms/inbound"
    params = {"From": "+19025551234", "Body": "STOP"}
    payload = url + "".join(k + params[k] for k in sorted(params))
    good = base64.b64encode(hmac.new(token.encode(), payload.encode(), hashlib.sha1).digest()).decode()

    assert sms_api.validate_twilio_signature(token, url, params, good)
    assert not sms_api.validate_twilio_signature(token, url, params, "bogus")
    assert not sms_api.validate_twilio_signature("", url, params, good)
    assert not sms_api.validate_twilio_signature(token, url, {"From": "+15555550000", "Body": "STOP"}, good)
