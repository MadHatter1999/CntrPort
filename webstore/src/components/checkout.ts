import { state, setCheckoutOpen, clearCart } from "../state/store";
import { getProducts, getStores, getConfig } from "../data/cms";
import { postOrder } from "../data/api";
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

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── derived from the live cart ───────────────────────────────────
function cartItems(): OrderItem[] {
  const byId = new Map(getProducts().map((p) => [p.id, p]));
  const items: OrderItem[] = [];
  for (const id in state.cart) {
    const p = byId.get(id);
    if (!p) continue;
    items.push({ id: p.id, name: p.name, price: p.price, unit: p.unit, qty: state.cart[id], image: p.image });
  }
  return items;
}

function totals(items: OrderItem[], fulfil: Fulfillment) {
  const subtotal = round2(items.reduce((s, i) => s + i.price * i.qty, 0));
  const shipping = fulfil === "shipping" ? SHIPPING_FLAT : 0;
  const tax = round2(subtotal * getConfig().taxRate);
  const total = round2(subtotal + shipping + tax);
  return { subtotal, shipping, tax, total };
}

// ── open / close ─────────────────────────────────────────────────
export function openCheckout(): void {
  if (Object.keys(state.cart).length === 0) return;
  placed = null;
  fulfillment = "pickup";
  renderCheckout();
  setCheckoutOpen(true);
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
      return /* html */ `
      <div class="co-line">
        <span class="co-line__qty">${it.qty}×</span>
        <span class="co-line__name" data-name-id="${it.id}">${esc(name)}</span>
        <span class="co-line__price">${money(it.price * it.qty, state.lang)}</span>
      </div>`;
    })
    .join("");
}

function totalsBlock(t0: ReturnType<typeof totals>): string {
  const shipVal = t0.shipping === 0 ? t("checkout.free") : money(t0.shipping, state.lang);
  return /* html */ `
    <dl class="co-totals">
      <div><dt>${esc(t("checkout.subtotal"))}</dt><dd>${money(t0.subtotal, state.lang)}</dd></div>
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
  const stores = getStores();
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
        <p class="co__test">${icon("card", 16)} ${esc(t("checkout.testMode"))}</p>
        ${fld(t("checkout.cardName"), "cardName")}
        ${fld(t("checkout.card"), "card", "text", 'inputmode="numeric" maxlength="19"', "4242 4242 4242 4242")}
        <div class="co__grid2">
          ${fld(t("checkout.expiry"), "expiry", "text", 'inputmode="numeric" maxlength="5"', "MM/YY")}
          ${fld(t("checkout.cvc"), "cvc", "text", 'inputmode="numeric" maxlength="4"', "123")}
        </div>
      </section>
    </div>

    <aside class="co__summary">
      <h3>${esc(t("checkout.summary"))}</h3>
      <div class="co-lines">${summaryRows(items)}</div>
      ${totalsBlock(t0)}
      <button type="submit" class="btn btn--primary btn--block co__place" data-co-place>
        ${esc(t("checkout.place", { total: money(t0.total, state.lang) }))}
      </button>
      <p class="co__secure">${icon("lock", 14)} ${esc(t("checkout.testMode"))}</p>
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
  const stores = getStores();
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
    payment: { method: "card", brand: cardBrand(cardNo), last4: cardNo.replace(/\D/g, "").slice(-4) },
    lang: state.lang,
  };

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
