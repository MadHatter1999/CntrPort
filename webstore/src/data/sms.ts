import { apiUrl, authHeaders } from "./api";
import type { Order } from "./orders";

/**
 * SMS client for the wrapper's /api/store/sms/* endpoints (Twilio behind the
 * server - credentials never reach this bundle).
 *
 * Two message kinds, deliberately kept apart:
 *  - Receipts: transactional, sent only when the shopper ticks "text me my
 *    receipt" at checkout (or an admin re-sends one). Order facts only -
 *    never any card data (PCI).
 *  - Marketing: CASL territory. The storefront records express consent
 *    (unchecked-by-default opt-in, exact wording stored server-side) and the
 *    admin can only campaign to that opted-in list; the server appends the
 *    store identification + STOP/ARRET footer to every send.
 */

export interface SmsStatus {
  enabled: boolean;
  fromNumber: string;
  quietStart: number;
  quietEnd: number;
}

export interface SmsSendResult {
  ok: boolean;
  disabled?: boolean;
  message?: string;
  sid?: string;
}

export interface SmsSubscriber {
  phone: string;
  name: string;
  consentAt: string;
  consentText: string;
  source: string;
  optedOut: boolean;
  optOutAt: string | null;
}

export interface SmsCampaign {
  at: string;
  message: string;
  body: string;
  sent: number;
  failed: number;
}

export interface SmsSubscribersView {
  ok: boolean;
  enabled: boolean;
  subscribers: SmsSubscriber[];
  counts: { active: number; optedOut: number };
  campaigns: SmsCampaign[];
}

export interface SmsCampaignResult {
  ok: boolean;
  disabled?: boolean;
  quietHours?: boolean;
  sent?: number;
  failed?: number;
  total?: number;
  message?: string;
}

const DISABLED_STATUS: SmsStatus = { enabled: false, fromNumber: "", quietStart: 9, quietEnd: 21 };

/** Secret-free status the storefront uses to show/hide the text opt-ins. */
export async function fetchSmsStatus(): Promise<SmsStatus> {
  try {
    const res = await fetch(apiUrl("/api/store/sms/status"), { headers: authHeaders() });
    if (!res.ok) return DISABLED_STATUS;
    return (await res.json()) as SmsStatus;
  } catch {
    return DISABLED_STATUS;
  }
}

async function postJSON<T>(path: string, payload: unknown, fallback: T): Promise<T> {
  try {
    const res = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

/** Text an order receipt. The server composes the message (order facts only). */
export function sendSmsReceipt(order: Order): Promise<SmsSendResult> {
  return postJSON(
    "/api/store/sms/receipt",
    {
      phone: order.customer.phone,
      ref: order.id,
      items: order.items.map((it) => ({ name: it.name, qty: it.qty })),
      total: order.total,
      fulfillment: order.fulfillment,
      store: order.storeName || "",
    },
    { ok: false, message: "network error" },
  );
}

/** Record express marketing consent (CASL): pass the exact consent wording the
 *  customer saw so the server can keep it as proof of consent. */
export function smsSubscribe(payload: {
  phone: string;
  name?: string;
  consentText: string;
  source: string;
}): Promise<SmsSendResult> {
  return postJSON("/api/store/sms/marketing/subscribe", payload, {
    ok: false,
    message: "network error",
  });
}

/** Opt a number out (admin action; STOP replies are handled server-side). */
export function smsUnsubscribe(phone: string): Promise<SmsSendResult> {
  return postJSON(
    "/api/store/sms/marketing/unsubscribe",
    { phone, source: "admin" },
    { ok: false, message: "network error" },
  );
}

/** Admin: consent ledger + campaign history. */
export async function fetchSmsSubscribers(): Promise<SmsSubscribersView> {
  const fallback: SmsSubscribersView = {
    ok: false,
    enabled: false,
    subscribers: [],
    counts: { active: 0, optedOut: 0 },
    campaigns: [],
  };
  try {
    const res = await fetch(apiUrl("/api/store/sms/subscribers"), { headers: authHeaders() });
    if (!res.ok) return fallback;
    return (await res.json()) as SmsSubscribersView;
  } catch {
    return fallback;
  }
}

/** Admin: send a marketing text to every opted-in subscriber. The server
 *  appends the store name + STOP footer and enforces the quiet-hours window. */
export function sendSmsCampaign(message: string): Promise<SmsCampaignResult> {
  return postJSON("/api/store/sms/campaign", { message }, { ok: false, message: "network error" });
}
