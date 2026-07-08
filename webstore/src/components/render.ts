import { getCategories, getProducts, getStores, getSlides, getConfig } from "../data/cms";
import { telHref, mapLinks } from "../data/stores";
import { pages } from "../data/pages";
import type { Product, Category } from "../data/types";
import { state, cartCount } from "../state/store";
import { t } from "../i18n";
import { money } from "../lib/format";
import { esc, $ } from "../lib/dom";
import { icon } from "../lib/icons";
import { catLabel, prodName, storeLabel, unitLabel, slideField } from "../lib/labels";

// Resolved once per load (storefront is static within a session; the admin tool
// is a separate page, so its edits show on next load). Call loadData() after the
// live catalog has been fetched.
let CATS: Category[] = getCategories();
let PRODS: Product[] = getProducts();
let byId = new Map(PRODS.map((p) => [p.id, p]));
let catById = new Map(CATS.map((c) => [c.id, c]));

/** Re-read catalog data (call after the data could have changed). */
export function loadData(): void {
  CATS = getCategories();
  PRODS = getProducts();
  byId = new Map(PRODS.map((p) => [p.id, p]));
  catById = new Map(CATS.map((c) => [c.id, c]));
}

/** Fill every translatable node under `root`. */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((el) => {
    (el as HTMLInputElement).placeholder = t(el.dataset.i18nPlaceholder!);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria!));
  });
}

/** Set the store name everywhere it appears (from the Counterpoint config). */
export function renderBrand(): void {
  const name = getConfig().name || "Web Store";
  document.querySelectorAll<HTMLElement>("[data-brand-name]").forEach((el) => {
    el.textContent = name;
  });
}

// ── Hero / carousel ──────────────────────────────────────────────
export function renderHero(): void {
  const slides = getSlides();
  $("#hero-track").innerHTML = slides
    .map((s, i) => {
      const cta = slideField(s, "cta", state.lang);
      const cls = s.bg ? "hero__slide hero__slide--img" : `hero__slide hero__slide--${(i % 3) + 1}`;
      const style = s.bg ? ` style="background-image:url('${s.bg.replace(/'/g, "%27")}')"` : "";
      return /* html */ `
      <div class="${cls}"${style}>
        <div class="hero__content">
          <h1>${esc(slideField(s, "title", state.lang))}</h1>
          <p>${esc(slideField(s, "sub", state.lang))}</p>
          ${cta ? `<button class="btn btn--primary" data-action="hero-cta">${esc(cta)}</button>` : ""}
        </div>
      </div>`;
    })
    .join("");
  $("#hero-dots").innerHTML = slides
    .map(
      (_, i) =>
        `<button class="hero__dot${i === 0 ? " is-active" : ""}" data-action="hero-dot" data-i="${i}" aria-label="Slide ${i + 1}"></button>`,
    )
    .join("");
}

// ── Stores ───────────────────────────────────────────────────────
function hoursDl(s: { monSat: string; sun: string }): string {
  if (!s.monSat && !s.sun) return "";
  const rows: string[] = [];
  if (s.monSat) rows.push(`<div><dt>${esc(t("store.monSat"))}</dt><dd>${esc(s.monSat)}</dd></div>`);
  if (s.sun) rows.push(`<div><dt>${esc(t("store.sun"))}</dt><dd>${esc(s.sun)}</dd></div>`);
  return `<dl class="store__hours">${rows.join("")}</dl>`;
}

function phoneBtn(phone: string): string {
  if (!phone) return "";
  return `<a class="btn btn--ghost btn--phone" href="${telHref(phone)}" aria-label="${esc(phone)}" title="${esc(phone)}">${icon("phone", 16)}<span class="phone-num">${esc(phone)}</span></a>`;
}

export function renderStores(): void {
  const stores = getStores();
  $("#store-grid").innerHTML = stores
    .map(
      (s) => /* html */ `
      <article class="store">
        <h3 class="store__name">${esc(storeLabel(s, state.lang))}</h3>
        <p class="store__addr">${esc(s.address)}</p>
        ${hoursDl(s)}
        <div class="store__actions">
          ${phoneBtn(s.phone)}
          <button class="btn btn--ghost" data-action="open-locations">${icon("pin", 16)} <span>${esc(t("store.viewMap"))}</span></button>
        </div>
      </article>`,
    )
    .join("");

  $("#footer-stores").innerHTML = stores
    .map((s) =>
      s.phone
        ? `<a href="${telHref(s.phone)}">${esc(storeLabel(s, state.lang))}: ${esc(s.phone)}</a>`
        : `<span>${esc(storeLabel(s, state.lang))}</span>`,
    )
    .join("");
}

export function renderLocations(): void {
  $("#locations-body").innerHTML = getStores()
    .map((s) => {
      const m = mapLinks(s.address);
      return /* html */ `
      <article class="loc">
        <div class="loc__map">
          <iframe class="locmap" data-src="${m.embed}" title="${esc(s.address)}"
                  loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>
        </div>
        <div class="loc__info">
          <h3>${esc(storeLabel(s, state.lang))}</h3>
          <p class="loc__addr">${esc(s.address)}</p>
          ${hoursDl(s)}
          <div class="loc__actions">
            ${phoneBtn(s.phone)}
            <a class="btn btn--ghost" href="${m.apple}" target="_blank" rel="noopener">${icon("pin", 16)} <span>${esc(t("locations.apple"))}</span></a>
            <a class="btn btn--primary" href="${m.google}" target="_blank" rel="noopener">${icon("arrow", 16)} <span>${esc(t("locations.google"))}</span></a>
          </div>
        </div>
      </article>`;
    })
    .join("");
}

// ── Category chips & grid ────────────────────────────────────────
export function renderChips(): void {
  const chips = [
    `<button class="chip${state.category === "all" ? " is-active" : ""}" data-action="chip" data-cat="all">${esc(t("chip.all"))}</button>`,
    ...CATS.map(
      (c) => `
      <button class="chip${state.category === c.id ? " is-active" : ""}" data-action="chip" data-cat="${c.id}">
        ${esc(catLabel(c, state.lang))}
      </button>`,
    ),
  ].join("");
  $("#chips").innerHTML = chips;
}

export function renderCategoryGrid(): void {
  $("#category-grid").innerHTML = CATS.map(
    (c) => /* html */ `
      <button class="cat-tile" data-action="chip" data-cat="${c.id}">
        <span class="cat-tile__thumb" style="--tint:${c.tint}">
          <img src="${esc(c.image)}" alt="" loading="lazy" decoding="async" />
        </span>
        <span class="cat-tile__name">${esc(catLabel(c, state.lang))}</span>
      </button>`,
  ).join("");
}

// ── Products ─────────────────────────────────────────────────────
function filtered(): Product[] {
  const q = state.query.trim().toLowerCase();
  return PRODS.filter((p) => {
    if (state.category !== "all" && p.categoryId !== state.category) return false;
    if (!q) return true;
    const cat = catById.get(p.categoryId);
    const hay = `${prodName(p, state.lang)} ${cat ? catLabel(cat, state.lang) : ""}`.toLowerCase();
    return hay.includes(q);
  });
}

function badge(p: Product): string {
  if (!p.badge) return "";
  return `<span class="badge badge--${p.badge}">${esc(t("badge." + p.badge))}</span>`;
}

function priceBlock(p: Product): string {
  const now = money(p.price, state.lang);
  const per = p.unit === "ea" ? "" : `<span class="price__unit">/ ${esc(unitLabel(p.unit, state.lang))}</span>`;
  const was = p.wasPrice
    ? `<span class="price__was">${esc(t("product.was"))} ${money(p.wasPrice, state.lang)}</span>`
    : "";
  return `<div class="price"><span class="price__now">${now}</span>${per}${was}</div>`;
}

function cartControl(p: Product): string {
  const qty = state.cart[p.id] ?? 0;
  if (qty <= 0) {
    return `<button class="btn btn--primary btn--add" data-action="add" data-id="${p.id}">
      ${icon("plus", 16)} ${esc(t("product.add"))}
    </button>`;
  }
  return `<div class="stepper" role="group" aria-label="${esc(t("cart.qty"))}">
    <button class="stepper__btn" data-action="dec" data-id="${p.id}" aria-label="−">${icon("minus", 16)}</button>
    <span class="stepper__val">${qty}</span>
    <button class="stepper__btn" data-action="add" data-id="${p.id}" aria-label="＋">${icon("plus", 16)}</button>
  </div>`;
}

function card(p: Product): string {
  const cat = catById.get(p.categoryId);
  return /* html */ `
    <article class="card${state.cart[p.id] ? " is-in-cart" : ""}" data-id="${p.id}">
      <div class="card__media" style="--tint:${cat?.tint ?? "#eee"}">
        ${badge(p)}
        <img class="card__img" src="${esc(p.image)}" alt="${esc(prodName(p, state.lang))}" loading="lazy" decoding="async" width="300" height="300" />
      </div>
      <div class="card__body">
        <h3 class="card__name" data-name-id="${p.id}">${esc(prodName(p, state.lang))}</h3>
        ${priceBlock(p)}
      </div>
      <div class="card__foot">${cartControl(p)}</div>
    </article>`;
}

// The grid is only rebuilt when the product SET/order/labels change (category
// or search) - never on a cart change. That keeps the <img>s alive so adding to
// cart can't make the whole grid re-decode and flicker.
let lastGridKey = "";

// Desktop-only pagination: over PAGE_SIZE items, wider viewports page through
// the list; phones keep the full scrolling grid (mobile left as-is).
const PAGE_SIZE = 20;
const DESKTOP_MQ = "(min-width: 768px)";

export function isDesktopViewport(): boolean {
  return window.matchMedia(DESKTOP_MQ).matches;
}

export function renderProducts(): void {
  const list = filtered();
  const title = $("#products-title");
  if (!state.query.trim() && state.category !== "all") {
    const c = catById.get(state.category);
    title.textContent = c ? catLabel(c, state.lang) : t("section.all");
  } else {
    title.textContent = t("section.all");
  }

  $("#results-count").textContent = t("results.count", { n: list.length });

  const paginate = isDesktopViewport() && list.length > PAGE_SIZE;
  const pageCount = paginate ? Math.ceil(list.length / PAGE_SIZE) : 1;
  const page = Math.min(Math.max(state.productPage, 1), pageCount);
  const shown = paginate ? list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : list;

  const grid = $("#product-grid");
  // Re-render when the shown set changes (category / search / page / breakpoint).
  // A cart change keeps the same key, so we only refresh add/qty controls and the
  // <img>s never churn.
  const key = `${state.category}|${state.query.trim()}|${paginate ? page : "all"}`;
  if (key === lastGridKey && grid.childElementCount > 0) {
    syncCartControls(grid);
    return;
  }
  lastGridKey = key;

  if (list.length === 0) {
    grid.innerHTML = `
      <div class="empty">
        <span class="empty__icon">${icon("search", 30)}</span>
        <p>${esc(t("results.none"))}</p>
        <button class="btn btn--ghost" data-action="clear-search">${esc(t("results.clear"))}</button>
      </div>`;
    renderPagination(false, 1, 1);
    return;
  }
  grid.innerHTML = shown.map(card).join("");
  renderPagination(paginate, page, pageCount);
}

/** Compact page list, e.g. 1 … 4 [5] 6 … 20. */
function pageWindow(current: number, total: number): (number | "…")[] {
  const near = new Set([1, total, current - 1, current, current + 1]);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (let i = 1; i <= total; i++) {
    if (!near.has(i)) continue;
    if (i - prev > 1) out.push("…");
    out.push(i);
    prev = i;
  }
  return out;
}

function pageBtn(
  pnum: number,
  label: string,
  opts: { current?: boolean; disabled?: boolean; aria?: string } = {},
): string {
  const attrs = [
    `class="pagination__btn${opts.current ? " is-current" : ""}"`,
    `data-action="goto-page"`,
    `data-pnum="${pnum}"`,
    opts.current ? `aria-current="page"` : "",
    opts.disabled ? "disabled" : "",
    opts.aria ? `aria-label="${esc(opts.aria)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<button ${attrs}>${esc(label)}</button>`;
}

function renderPagination(show: boolean, page: number, pageCount: number): void {
  const el = $("#pagination");
  if (!show) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  const parts = [
    pageBtn(page - 1, t("pager.prev"), { disabled: page <= 1, aria: t("pager.prev") }),
    ...pageWindow(page, pageCount).map((it) =>
      it === "…"
        ? `<span class="pagination__gap" aria-hidden="true">…</span>`
        : pageBtn(it, String(it), { current: it === page }),
    ),
    pageBtn(page + 1, t("pager.next"), { disabled: page >= pageCount, aria: t("pager.next") }),
  ];
  el.innerHTML = parts.join("");
  el.hidden = false;
}

/** Update only each card's in-cart state + add/qty control (no image churn). */
function syncCartControls(grid: HTMLElement): void {
  grid.querySelectorAll<HTMLElement>(".card").forEach((el) => {
    const id = el.dataset.id;
    if (!id) return;
    const p = byId.get(id);
    if (!p) return;
    const inCart = !!state.cart[id];
    el.classList.toggle("is-in-cart", inCart);
    const foot = el.querySelector(".card__foot");
    if (foot) foot.innerHTML = cartControl(p);
  });
}

// ── Cart ─────────────────────────────────────────────────────────
let lastCartKey = "";

export function renderCart(): void {
  // Skip rebuilding the cart (and its thumbnails) unless it actually changed.
  const key = JSON.stringify(state.cart);
  if (key === lastCartKey) return;
  lastCartKey = key;

  const ids = Object.keys(state.cart);
  const body = $("#cart-body");
  const foot = $("#cart-foot");

  if (ids.length === 0) {
    body.innerHTML = `
      <div class="cart__empty">
        <span class="cart__empty-icon">${icon("bag", 34)}</span>
        <p class="cart__empty-title">${esc(t("cart.empty"))}</p>
        <p class="cart__empty-sub">${esc(t("cart.emptySub"))}</p>
        <button class="btn btn--primary" data-action="close-cart">${esc(t("cart.browse"))}</button>
      </div>`;
    foot.hidden = true;
    return;
  }

  let subtotal = 0;
  const rows = ids
    .map((id) => {
      const p = byId.get(id);
      if (!p) return "";
      const qty = state.cart[id];
      subtotal += p.price * qty;
      const cat = catById.get(p.categoryId);
      return /* html */ `
      <div class="crow" data-id="${id}">
        <span class="crow__thumb" style="--tint:${cat?.tint ?? "#eee"}">
          <img src="${esc(p.image)}" alt="" loading="lazy" />
        </span>
        <div class="crow__info">
          <span class="crow__name" data-name-id="${id}">${esc(prodName(p, state.lang))}</span>
          <span class="crow__unit">${money(p.price, state.lang)}${p.unit === "ea" ? "" : ` / ${esc(unitLabel(p.unit, state.lang))}`}</span>
        </div>
        <div class="stepper stepper--sm" role="group">
          <button class="stepper__btn" data-action="dec" data-id="${id}" aria-label="−">${icon("minus", 14)}</button>
          <span class="stepper__val">${qty}</span>
          <button class="stepper__btn" data-action="add" data-id="${id}" aria-label="＋">${icon("plus", 14)}</button>
        </div>
        <span class="crow__price">${money(p.price * qty, state.lang)}</span>
      </div>`;
    })
    .join("");

  body.innerHTML = rows;
  foot.hidden = false;
  $("#cart-subtotal").textContent = money(subtotal, state.lang);
}

// ── Info pages ───────────────────────────────────────────────────
/** Turn emails and North-American phone numbers (in already-escaped text) into
 *  mailto:/tel: links so they're tappable on every device. */
function linkifyContacts(escaped: string): string {
  let out = escaped.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    (m) => `<a class="tel" href="mailto:${m}">${m}</a>`,
  );
  out = out.replace(/\(?\+?\d[\d\s().+-]{6,}\d/g, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 11) return m;
    const tel = digits.length === 11 ? "+" + digits : "+1" + digits;
    return `<a class="tel" href="tel:${tel}">${m.trim()}</a>`;
  });
  return out;
}

export function renderPage(): void {
  if (!state.page) return; // keep last content while it animates closed
  const page = pages.find((p) => p.id === state.page);
  if (!page) return;
  $("#page-title").textContent = t(page.titleKey);

  const fmt = (s: string) => linkifyContacts(esc(s));
  let html = "";
  let inList = false;
  for (const b of page.body) {
    if (b.t === "li") {
      if (!inList) ((html += "<ul>"), (inList = true));
      html += `<li>${fmt(b.text)}</li>`;
      continue;
    }
    if (inList) ((html += "</ul>"), (inList = false));
    html += b.t === "h" ? `<h3>${fmt(b.text)}</h3>` : `<p>${fmt(b.text)}</p>`;
  }
  if (inList) html += "</ul>";
  $("#page-body").innerHTML = html;
}

// ── Header / nav badges ──────────────────────────────────────────
export function renderBadges(): void {
  const n = cartCount();
  for (const sel of ["#cart-count", "#bottom-count"]) {
    const el = $(sel);
    el.textContent = String(n);
    el.hidden = n === 0;
  }
}

export function syncDocTitle(): void {
  const name = getConfig().name || "Web Store";
  document.title = `${name} - ${t("brand.tagline")}`;
}
