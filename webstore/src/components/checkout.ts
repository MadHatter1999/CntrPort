import { state, setCheckoutOpen, clearCart } from "../state/store";
import { getProducts, getVisibleStores, getConfig } from "../data/cms";
import { postOrder, confirmPromotions } from "../data/api";
import { fetchPaymentStatus, providerLabel, type PaymentStatus } from "../data/payments";
import {
  fetchSmsStatus,
  sendSmsReceipt,
  smsSubscribe,
  sendEmailReceipt,
  emailSubscribe,
  type SmsStatus,
} from "../data/sms";
import { t } from "../i18n";
import { money } from "../lib/format";
import { esc, $ } from "../lib/dom";
import { icon } from "../lib/icons";
import { prodName, storeLabel } from "../lib/labels";
import {
  addOrder,
  updateOrder,
  nextOrderRef,
  cardBrand,
  SHIPPING_FLAT,
  ORDER_STATUSES,
  type Order,
  type Fulfillment,
  type OrderItem,
} from "../data/orders";

/** When set, the panel shows the confirmation screen instead of the form. */
let placed: Order | null = null;
let fulfillment: Fulfillment = "pickup";

// Live vs demo checkout, decided by the admin-configured processor. Defaults to
// demo and is refreshed (secret-free) each time checkout opens.
let payStatus: PaymentStatus = { mode: "demo", provider: "", environment: "", publicConfig: {} };

// Whether the server has Twilio SMS / SendGrid email configured - decides
// which receipt/marketing opt-ins the form shows.
let smsStatus: SmsStatus = {
  enabled: false,
  fromNumber: "",
  emailEnabled: false,
  emailFrom: "",
  quietStart: 9,
  quietEnd: 21,
};
// Outcome of the receipt text for the confirmation screen ("" = not requested).
let receiptTextState: "" | "pending" | "sent" | "failed" = "";

// Prices confirmed against active planned promotions at checkout time, plus each
// item's required deposit (bottle deposit). Empty until the confirm call resolves.
let confirmed: Record<string, { price: number; regPrice: number; onPromo: boolean; deposit: number }> = {};

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── derived from the live cart ───────────────────────────────────
function cartItems(): OrderItem[] {
  const byId = new Map(getProducts().map((p) => [p.id, p]));
  const items: OrderItem[] = [];
  for (const id in state.cart) {
    const p = byId.get(id);
    if (!p) continue;
    // A confirmed planned-promo price (from the server) wins over the page price.
    const price = confirmed[id]?.price ?? p.price;
    items.push({ id: p.id, name: p.name, price, unit: p.unit, qty: state.cart[id], image: p.image });
  }
  return items;
}

function totals(items: OrderItem[], fulfil: Fulfillment) {
  const subtotal = round2(items.reduce((s, i) => s + i.price * i.qty, 0));
  // Required deposits (bottle deposit etc.) - CP charges these, so we do too.
  const deposits = round2(items.reduce((s, i) => s + (confirmed[i.id]?.deposit ?? 0) * i.qty, 0));
  const shipping = fulfil === "shipping" ? SHIPPING_FLAT : 0;
  const tax = round2(subtotal * getConfig().taxRate);
  const total = round2(subtotal + deposits + shipping + tax);
  return { subtotal, deposits, shipping, tax, total };
}

// ── open / close ─────────────────────────────────────────────────
export function openCheckout(): void {
  if (Object.keys(state.cart).length === 0) return;
  placed = null;
  fulfillment = "pickup";
  confirmed = {};
  receiptTextState = "";
  renderCheckout();
  setCheckoutOpen(true);
  // Refresh the live/demo decision from the server (secret-free). Re-render the
  // form once known so the payment section reflects the configured processor.
  void fetchPaymentStatus().then((s) => {
    payStatus = s;
    if (!placed) renderCheckout();
  });
  // Same for SMS: the text opt-ins only render when Twilio is configured.
  void fetchSmsStatus().then((s) => {
    smsStatus = s;
    if (!placed) renderCheckout();
  });
  // Confirm planned promotions against the live catalogue with the real cart
  // quantities, then re-render so the totals reflect the confirmed prices.
  const cartForPromo = Object.keys(state.cart).map((id) => ({ id, qty: state.cart[id] }));
  void confirmPromotions(cartForPromo).then((res) => {
    if (!res.ok) return;
    confirmed = {};
    for (const l of res.items) {
      confirmed[l.id] = { price: l.price, regPrice: l.regPrice, onPromo: l.onPromo, deposit: l.deposit ?? 0 };
    }
    if (!placed) renderCheckout();
  });
}

export function closeCheckout(): void {
  setCheckoutOpen(false);
}

// ── views ────────────────────────────────────────────────────────
export function renderCheckout(): void {
  const body = $("#checkout-body");
  body.innerHTML = placed ? confirmationHTML(placed) : formHTML();
  body.scrollTop = 0;
}

function summaryRows(items: OrderItem[]): string {
  const byId = new Map(getProducts().map((p) => [p.id, p]));
  return items
    .map((it) => {
      const p = byId.get(it.id);
      const name = p ? prodName(p, state.lang) : it.name;
      const c = confirmed[it.id];
      const priceHtml =
        c?.onPromo
          ? `<span class="co-line__was">${money(c.regPrice * it.qty, state.lang)}</span> ${money(it.price * it.qty, state.lang)}`
          : money(it.price * it.qty, state.lang);
      return /* html */ `
      <div class="co-line">
        <span class="co-line__qty">${it.qty}×</span>
        <span class="co-line__name" data-name-id="${it.id}">${esc(name)}${c?.onPromo ? ` <span class="co-line__promo">${esc(t("checkout.promo"))}</span>` : ""}</span>
        <span class="co-line__price">${priceHtml}</span>
      </div>`;
    })
    .join("");
}

function totalsBlock(t0: {
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  deposits?: number;
}): string {
  const shipVal = t0.shipping === 0 ? t("checkout.free") : money(t0.shipping, state.lang);
  const deposits = t0.deposits ?? 0;
  const depositRow =
    deposits > 0
      ? `<div><dt>${esc(t("checkout.deposits"))}</dt><dd>${money(deposits, state.lang)}</dd></div>`
      : "";
  return /* html */ `
    <dl class="co-totals">
      <div><dt>${esc(t("checkout.subtotal"))}</dt><dd>${money(t0.subtotal, state.lang)}</dd></div>
      ${depositRow}
      <div><dt data-ship-label>${esc(t("checkout.ship"))}</dt><dd data-ship>${shipVal}</dd></div>
      <div><dt>${esc(t("checkout.tax"))}</dt><dd>${money(t0.tax, state.lang)}</dd></div>
      <div class="co-totals__grand"><dt>${esc(t("checkout.total"))}</dt><dd data-grand>${money(t0.total, state.lang)}</dd></div>
    </dl>`;
}

function fld(label: string, name: string, type = "text", attrs = "", placeholder = ""): string {
  return /* html */ `
    <label class="fld">
      <span>${esc(label)}</span>
      <input class="co-input" data-co-field="${name}" type="${type}" ${attrs}
             ${placeholder ? `placeholder="${esc(placeholder)}"` : ""} autocomplete="off" />
    </label>`;
}

function formHTML(): string {
  const items = cartItems();
  const t0 = totals(items, fulfillment);
  const stores = getVisibleStores();
  const storeOpts = stores
    .map((s) => `<option value="${esc(s.id)}">${esc(storeLabel(s, state.lang))}</option>`)
    .join("");

  return /* html */ `
  <form class="co" id="checkout-form" data-fulfil="${fulfillment}" novalidate>
    <div class="co__main">
      <p class="co__error" data-co-error hidden></p>

      <section class="co__sec">
        <h3>${icon("truck", 18)} ${esc(t("checkout.fulfil"))}</h3>
        <div class="co__choices">
          <label class="co__choice">
            <input type="radio" name="fulfil" value="pickup" ${fulfillment === "pickup" ? "checked" : ""} />
            <span class="co__choice-ic">${icon("store", 22)}</span>
            <span class="co__choice-txt"><b>${esc(t("checkout.pickup"))}</b><small>${esc(t("checkout.pickupSub"))}</small></span>
          </label>
          <label class="co__choice">
            <input type="radio" name="fulfil" value="shipping" ${fulfillment === "shipping" ? "checked" : ""} />
            <span class="co__choice-ic">${icon("truck", 22)}</span>
            <span class="co__choice-txt"><b>${esc(t("checkout.shipping"))}</b><small>${esc(t("checkout.shippingSub", { fee: money(SHIPPING_FLAT, state.lang) }))}</small></span>
          </label>
        </div>
        <label class="fld co__pickup-only">
          <span>${esc(t("checkout.pickStore"))}</span>
          <select class="co-input" data-co-field="storeId">${storeOpts}</select>
        </label>
      </section>

      <section class="co__sec co__ship-only">
        <h3>${icon("pin", 18)} ${esc(t("checkout.shipTo"))}</h3>
        ${fld(t("checkout.address"), "address")}
        <div class="co__grid2">
          ${fld(t("checkout.city"), "city")}
          ${fld(t("checkout.postal"), "postal")}
        </div>
      </section>

      <section class="co__sec">
        <h3>${icon("user", 18)} ${esc(t("checkout.contact"))}</h3>
        ${fld(t("checkout.name"), "name")}
        <div class="co__grid2">
          ${fld(t("checkout.email"), "email", "email")}
          ${fld(t("checkout.phone"), "phone", "tel")}
        </div>
        <label class="fld">
          <span>${esc(t("checkout.notes"))}</span>
          <textarea class="co-input" data-co-field="notes" rows="2" placeholder="${esc(t("checkout.notesPh"))}"></textarea>
        </label>
      </section>

      <section class="co__sec">
        <h3>${icon("lock", 18)} ${esc(t("checkout.payment"))}</h3>
        ${
          payStatus.mode === "live"
            ? `<p class="co__live">${icon("lock", 16)} ${esc(t("checkout.securePayment", { provider: providerLabel(payStatus.provider) }))}${payStatus.environment ? ` <span class="co__env">${esc(payStatus.environment)}</span>` : ""}</p>`
            : `<p class="co__test">${icon("card", 16)} ${esc(t("checkout.testMode"))}</p>`
        }
        ${fld(t("checkout.cardName"), "cardName")}
        ${fld(t("checkout.card"), "card", "text", 'inputmode="numeric" maxlength="19"', "4242 4242 4242 4242")}
        <div class="co__grid2">
          ${fld(t("checkout.expiry"), "expiry", "text", 'inputmode="numeric" maxlength="5"', "MM/YY")}
          ${fld(t("checkout.cvc"), "cvc", "text", 'inputmode="numeric" maxlength="4"', "123")}
        </div>
      </section>

      ${
        smsStatus.enabled || smsStatus.emailEnabled
          ? /* html */ `
      <section class="co__sec">
        <h3>${icon("phone", 18)} ${esc(t("checkout.texts"))}</h3>
        ${
          smsStatus.enabled
            ? `<label class="co-check">
          <input type="checkbox" data-co-field="smsReceipt" />
          <span>${esc(t("checkout.smsReceipt"))}</span>
        </label>
        <!-- CASL: express consent must be an unchecked, optional opt-in with
             the sender named; the exact wording is stored server-side as the
             proof-of-consent record. Same for the email opt-in below. -->
        <label class="co-check">
          <input type="checkbox" data-co-field="smsMarketing" />
          <span>${esc(t("checkout.smsMarketing", { store: getConfig().name }))}</span>
        </label>`
            : ""
        }
        ${
          smsStatus.emailEnabled
            ? `<label class="co-check">
          <input type="checkbox" data-co-field="emailMarketing" />
          <span>${esc(t("checkout.emailMarketing", { store: getConfig().name }))}</span>
        </label>`
            : ""
        }
        <p class="co__fine">${esc(t("checkout.smsFine"))}</p>
      </section>`
          : ""
      }
    </div>

    <aside class="co__summary">
      <h3>${esc(t("checkout.summary"))}</h3>
      <div class="co-lines">${summaryRows(items)}</div>
      ${totalsBlock(t0)}
      <button type="submit" class="btn btn--primary btn--block co__place" data-co-place>
        ${esc(t("checkout.place", { total: money(t0.total, state.lang) }))}
      </button>
      <p class="co__secure">${icon("lock", 14)} ${esc(payStatus.mode === "live" ? t("checkout.securePayment", { provider: providerLabel(payStatus.provider) }) : t("checkout.testMode"))}</p>
    </aside>
  </form>`;
}

function statusSteps(active: number): string {
  // pickup/ship share a 4-step happy path (cancelled is not shown here).
  const labels = ORDER_STATUSES.slice(0, 4);
  return /* html */ `
    <ol class="co-steps">
      ${labels
        .map((s, i) => {
          const cls = i < active ? "is-done" : i === active ? "is-active" : "";
          return `<li class="co-step ${cls}"><span class="co-step__dot">${i < active ? icon("check", 12) : i + 1}</span><span>${esc(t("order.status." + s))}</span></li>`;
        })
        .join("")}
    </ol>`;
}

function confirmationHTML(o: Order): string {
  const info =
    o.fulfillment === "pickup"
      ? t("checkout.pickupInfo", { store: o.storeName || "" })
      : t("checkout.shipInfo", { address: [o.customer.address, o.customer.city].filter(Boolean).join(", ") });

  return /* html */ `
  <div class="co-done">
    <span class="co-done__icon">${icon("checkCircle", 52)}</span>
    <h2>${esc(t("checkout.confirmTitle"))}</h2>
    <p class="co-done__thanks">${esc(t("checkout.confirmThanks", { name: o.customer.name.split(" ")[0] }))}</p>

    <div class="co-done__ref">
      <span>${esc(t("checkout.ref"))}</span>
      <strong>${esc(o.id)}</strong>
    </div>

    ${statusSteps(1)}

    <p class="co-done__info">${esc(info)}</p>
    <p class="co-done__emailed">${icon("mail", 14)} ${esc(t("checkout.emailed", { email: o.customer.email }))}</p>
    ${
      receiptTextState === "sent"
        ? `<p class="co-done__emailed">${icon("phone", 14)} ${esc(t("checkout.texted", { phone: o.customer.phone }))}</p>`
        : receiptTextState === "failed"
          ? `<p class="co-done__emailed">${icon("phone", 14)} ${esc(t("checkout.textFailed"))}</p>`
          : ""
    }

    <div class="co-done__summary">
      <div class="co-lines">${summaryRows(o.items)}</div>
      ${totalsBlock({ subtotal: o.subtotal, shipping: o.shipping, tax: o.tax, total: o.total })}
    </div>

    <button type="button" class="btn btn--primary btn--block" data-co="continue">${esc(t("checkout.continue"))}</button>
  </div>`;
}

// ── live updates (no re-render, keeps typed input) ───────────────
function recalcSummary(form: HTMLFormElement): void {
  const items = cartItems();
  const t0 = totals(items, fulfillment);
  const shipVal = t0.shipping === 0 ? t("checkout.free") : money(t0.shipping, state.lang);
  form.querySelector("[data-ship]")!.textContent = shipVal;
  form.querySelector("[data-grand]")!.textContent = money(t0.total, state.lang);
  const place = form.querySelector<HTMLButtonElement>("[data-co-place]");
  if (place) place.textContent = t("checkout.place", { total: money(t0.total, state.lang) });
}

function field(form: HTMLFormElement, name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  return form.querySelector(`[data-co-field="${name}"]`);
}

function val(form: HTMLFormElement, name: string): string {
  return field(form, name)?.value.trim() ?? "";
}

function validate(form: HTMLFormElement): boolean {
  const required = ["name", "email", "phone", "cardName", "card", "expiry", "cvc"];
  if (fulfillment === "shipping") required.push("address", "city", "postal");

  let firstBad: HTMLElement | null = null;
  form.querySelectorAll(".is-invalid").forEach((el) => el.classList.remove("is-invalid"));

  for (const name of required) {
    const el = field(form, name);
    if (!el) continue;
    let bad = el.value.trim() === "";
    if (name === "card") bad = el.value.replace(/\D/g, "").length < 15;
    if (name === "expiry") bad = !/^\d{2}\/\d{2}$/.test(el.value.trim());
    if (name === "cvc") bad = !/^\d{3,4}$/.test(el.value.trim());
    if (name === "email") bad = bad || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(el.value.trim());
    if (bad) {
      el.classList.add("is-invalid");
      firstBad ??= el;
    }
  }

  const err = form.querySelector<HTMLElement>("[data-co-error]")!;
  if (firstBad) {
    err.textContent = t("checkout.invalid");
    err.hidden = false;
    firstBad.focus();
    firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  }
  err.hidden = true;
  return true;
}

function placeOrder(form: HTMLFormElement): void {
  if (!validate(form)) return;
  const items = cartItems();
  if (items.length === 0) return;
  const t0 = totals(items, fulfillment);
  // PCI: we never persist or transmit the PAN or CVC. Only a derived brand and
  // the last 4 digits are kept (both allowed by PCI-DSS). `cardNo`/CVC stay in
  // local form state for this function and are discarded on render. A real
  // deployment must hand card capture to a PCI-compliant processor (e.g. Stripe
  // hosted fields) so the number never touches our code at all.
  const cardNo = val(form, "card");
  const stores = getVisibleStores();
  const storeId = fulfillment === "pickup" ? val(form, "storeId") || stores[0]?.id : undefined;
  const store = stores.find((s) => s.id === storeId);

  const order: Order = {
    id: nextOrderRef(),
    createdAt: Date.now(),
    status: "new",
    fulfillment,
    storeId,
    storeName: store ? store.name : undefined,
    customer: {
      name: val(form, "name"),
      email: val(form, "email"),
      phone: val(form, "phone"),
      ...(fulfillment === "shipping"
        ? { address: val(form, "address"), city: val(form, "city"), postal: val(form, "postal") }
        : {}),
      notes: val(form, "notes") || undefined,
    },
    items,
    subtotal: t0.subtotal,
    shipping: t0.shipping,
    tax: t0.tax,
    total: t0.total,
    payment: {
      method: "card",
      brand: cardBrand(cardNo),
      last4: cardNo.replace(/\D/g, "").slice(-4),
      mode: payStatus.mode,
      provider: payStatus.mode === "live" ? payStatus.provider : undefined,
    },
    lang: state.lang,
  };

  // NOTE: In live mode this records the order against the configured processor,
  // but the actual charge/tokenization is a per-provider server integration that
  // must be wired in (the storefront must never handle raw PANs for a live
  // gateway - use the provider's hosted fields / tokenization). Until that seam
  // is implemented, treat "live" as "configured" rather than "charged".

  // Record the order locally first - the admin Orders screen is the source of
  // truth and must capture every checkout even if the Counterpoint write fails.
  addOrder(order);

  // Post the order to Counterpoint (creates a Document). Best-effort: a failure
  // doesn't block the shopper, and the admin already has the record.
  void postOrder({
    ref: order.id,
    items: order.items.map((it) => ({ id: it.id, qty: it.qty, price: it.price })),
    customer: order.customer,
    fulfillment: order.fulfillment,
    storeId: order.storeId,
  }).then((res) => {
    if (res.doc_id) updateOrder(order.id, { cpDocId: res.doc_id });
  });

  // Text messaging (only offered when the server has Twilio configured).
  const wantsReceipt = (field(form, "smsReceipt") as HTMLInputElement | null)?.checked ?? false;
  const wantsMarketing = (field(form, "smsMarketing") as HTMLInputElement | null)?.checked ?? false;
  const wantsEmailMarketing =
    (field(form, "emailMarketing") as HTMLInputElement | null)?.checked ?? false;
  if (smsStatus.enabled && wantsReceipt) {
    receiptTextState = "pending";
    void sendSmsReceipt(order).then((r) => {
      receiptTextState = r.ok ? "sent" : "failed";
      // Update the confirmation screen in place once the outcome is known.
      if (placed === order) renderCheckout();
    });
  }
  // Email receipt is transactional: sent automatically when email is
  // configured (the confirmation screen already tells the shopper it's coming).
  if (smsStatus.emailEnabled && order.customer.email) {
    void sendEmailReceipt(order);
  }
  if (smsStatus.enabled && wantsMarketing) {
    // CASL: store the exact wording the shopper agreed to with the consent.
    void smsSubscribe({
      phone: order.customer.phone,
      name: order.customer.name,
      consentText:
        t("checkout.smsMarketing", { store: getConfig().name }) + " " + t("checkout.smsFine"),
      source: "checkout",
    });
  }
  if (smsStatus.emailEnabled && wantsEmailMarketing) {
    void emailSubscribe({
      email: order.customer.email,
      name: order.customer.name,
      consentText:
        t("checkout.emailMarketing", { store: getConfig().name }) + " " + t("checkout.smsFine"),
      source: "checkout",
    });
  }

  clearCart();
  placed = order;
  renderCheckout();
}

// ── input formatting (card / expiry / cvc) ───────────────────────
function formatPayment(el: HTMLInputElement): void {
  const name = el.dataset.coField;
  if (name === "card") {
    const d = el.value.replace(/\D/g, "").slice(0, 16);
    el.value = d.replace(/(.{4})/g, "$1 ").trim();
  } else if (name === "expiry") {
    const d = el.value.replace(/\D/g, "").slice(0, 4);
    el.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  } else if (name === "cvc") {
    el.value = el.value.replace(/\D/g, "").slice(0, 4);
  }
}

// ── wire events (document-level delegation, scoped to #checkout) ──
// Delegated on document because the shell mounts after this module loads.
function inCheckout(e: Event): HTMLElement | null {
  return (e.target as HTMLElement).closest<HTMLElement>("#checkout");
}

document.addEventListener("change", (e) => {
  if (!inCheckout(e)) return;
  const el = e.target as HTMLInputElement;
  if (el.name === "fulfil") {
    fulfillment = el.value as Fulfillment;
    const form = el.closest<HTMLFormElement>("#checkout-form");
    if (form) {
      form.dataset.fulfil = fulfillment;
      recalcSummary(form);
    }
  }
});

document.addEventListener("input", (e) => {
  if (!inCheckout(e)) return;
  const el = e.target as HTMLInputElement;
  if (el.dataset.coField && ["card", "expiry", "cvc"].includes(el.dataset.coField)) {
    formatPayment(el);
    el.classList.remove("is-invalid");
  }
});

document.addEventListener("submit", (e) => {
  const form = (e.target as HTMLElement).closest<HTMLFormElement>("#checkout-form");
  if (!form) return;
  e.preventDefault();
  placeOrder(form);
});

document.addEventListener("click", (e) => {
  if (!inCheckout(e)) return;
  const co = (e.target as HTMLElement).closest<HTMLElement>("[data-co]")?.dataset.co;
  if (co === "continue") closeCheckout();
});
