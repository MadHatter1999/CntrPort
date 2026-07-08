import "./admin.css";
import {
  getCategories,
  getProducts,
  getStores,
  getSlides,
  saveCategories,
  saveProducts,
  saveStores,
  saveSlides,
  exportData,
  importData,
  resetAll,
  loadCatalog,
  getConfig,
} from "../data/cms";
import {
  getOrders,
  saveOrders,
  updateOrder,
  removeOrder,
  subscribeOrders,
  ORDER_STATUSES,
  type Order,
  type OrderStatus,
} from "../data/orders";
import { requireAuth, signOutAdmin, currentUserLabel } from "./auth";
import {
  PAYMENT_PROVIDERS,
  getProvider,
  providerLabel,
  fetchPaymentConfig,
  savePaymentConfig,
  type PaymentConfigView,
} from "../data/payments";
import { translate, languages } from "../i18n";
import { slideField } from "../lib/labels";
import { esc } from "../lib/dom";
import { icon } from "../lib/icons";
import type { Product, Category, Slide } from "../data/types";
import type { StoreInfo } from "../data/stores";

// Languages that need per-item name overrides (everything except English).
const EXTRA = languages.filter((l) => l.code !== "en");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || uid("c");

/** Seed categories carry an i18n key; lift it into literal name + per-lang names
 *  so the admin can see and edit the current translations directly. */
function normalizeCats(cats: Category[]): Category[] {
  return cats.map((c) => {
    if (c.name || !c.nameKey) return c;
    const names: Record<string, string> = {};
    EXTRA.forEach((l) => (names[l.code] = translate(l.code, c.nameKey!)));
    return { ...c, name: translate("en", c.nameKey), names };
  });
}

const DB = {
  products: [] as Product[],
  categories: [] as Category[],
  stores: [] as StoreInfo[],
  slides: [] as Slide[],
  orders: [] as Order[],
};

/** Populate DB from the live Counterpoint catalog + local order log. Called
 *  after loadCatalog() resolves so the admin shows real data. */
function loadDB(): void {
  DB.products = clone(getProducts());
  DB.categories = normalizeCats(clone(getCategories()));
  DB.stores = clone(getStores()) as StoreInfo[];
  DB.slides = clone(getSlides()) as Slide[];
  DB.orders = clone(getOrders()) as Order[];
}

type Section =
  | "dashboard"
  | "orders"
  | "products"
  | "categories"
  | "stores"
  | "slides"
  | "payments"
  | "settings";
const view: {
  section: Section;
  editing: string | "new" | null;
  query: string;
  statusFilter: string;
} = {
  section: "dashboard",
  editing: null,
  query: "",
  statusFilter: "all",
};

// Payments: server-held config (secrets redacted) + the in-form provider/env
// selection (before Save). Loaded once at startup, refreshed after each save.
let payCfg: PaymentConfigView | null = null;
const payForm: { provider: string; environment: string } = { provider: "", environment: "" };

const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "New",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
};

const fmtMoney = (n: number): string => "$" + n.toFixed(2);
const fmtDate = (ts: number): string =>
  new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Filter a list by the current search query against a per-item searchable string. */
function filterList<T>(items: T[], fields: (i: T) => string): T[] {
  const q = view.query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => fields(i).toLowerCase().includes(q));
}

const app = document.getElementById("admin-app")!;

// ── small utilities ──────────────────────────────────────────────
function toast(msg: string): void {
  let el = document.querySelector<HTMLElement>(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el!.classList.remove("show"), 1600);
}

function download(name: string, text: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Resize an uploaded image and return a compact webp data URL (keeps
 *  localStorage small). */
function fileToDataURL(file: File, max = 700): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        cv.getContext("2d")!.drawImage(img, 0, 0, w, h);
        res(cv.toDataURL("image/webp", 0.82));
      };
      img.onerror = rej;
      img.src = reader.result as string;
    };
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

const catName = (id: string) => DB.categories.find((c) => c.id === id)?.name ?? id;

// ── form field builders ──────────────────────────────────────────
function input(label: string, name: string, value: string | number = "", type = "text", attrs = ""): string {
  return `<label class="fld"><span>${esc(label)}</span>
    <input data-field="${name}" type="${type}" value="${esc(String(value))}" ${attrs} /></label>`;
}
function imageField(label: string, name: string, value = ""): string {
  return `<div class="fld"><span>${esc(label)}</span>
    <div class="imgfield">
      <img class="imgprev" src="${esc(value)}" ${value ? "" : "hidden"} alt="" />
      <input data-field="${name}" type="text" placeholder="/images/… , https://… , or upload →" value="${esc(value)}" />
      <input type="file" accept="image/*" data-img-file />
    </div></div>`;
}
function langNames(names: Record<string, string> = {}): string {
  return `<div class="fld"><span>Name- other languages (optional)</span>
    <div class="grid-lang">
      ${EXTRA.map(
        (l) =>
          `<label class="fld"><span>${l.flag} ${esc(l.native)}</span>
           <input data-field="names.${l.code}" type="text" value="${esc(names[l.code] || "")}" /></label>`,
      ).join("")}
    </div></div>`;
}

// ── views ────────────────────────────────────────────────────────
const SECTIONS: { id: Section; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "orders", label: "Orders" },
  { id: "products", label: "Items" },
  { id: "categories", label: "Categories" },
  { id: "stores", label: "Locations" },
  { id: "slides", label: "Carousel" },
  { id: "payments", label: "Payments" },
  { id: "settings", label: "Settings" },
];

function sidebar(): string {
  const counts: Record<string, number> = {
    orders: DB.orders.length,
    products: DB.products.length,
    categories: DB.categories.length,
    stores: DB.stores.length,
    slides: DB.slides.length,
  };
  return `<aside class="side">
    <div class="side__brand">
      <img class="brand__badge" src="/favicon.svg" alt="" />
      <div><b>${esc(getConfig().name)} Admin</b><small>internal tool</small></div>
    </div>
    ${SECTIONS.map(
      (s) =>
        `<button class="navbtn${view.section === s.id ? " is-active" : ""}" data-nav="${s.id}">
          <span>${s.label}</span>${counts[s.id] != null ? `<span class="count">${counts[s.id]}</span>` : ""}
        </button>`,
    ).join("")}
    <div class="side__spacer"></div>
    <div class="side__foot">
      <div class="side__user">${icon("user", 14)} <span>${esc(currentUserLabel())}</span></div>
      <button class="side__logout" data-act="logout">${icon("lock", 14)} Sign out</button>
      <a href="/">← View storefront</a>
    </div>
  </aside>`;
}

function listProducts(): string {
  const rows = filterList(DB.products, (p) =>
    [p.name, ...Object.values(p.names || {}), p.unit, catName(p.categoryId), p.badge || ""].join(" "),
  )
    .map(
      (p) => `<tr>
      <td><img class="thumb" src="${esc(p.image)}" alt="" /></td>
      <td><b>${esc(p.name)}</b>${p.names && Object.keys(p.names).length ? ' <span class="pill">i18n</span>' : ""}</td>
      <td class="muted">${esc(catName(p.categoryId))}</td>
      <td>$${p.price.toFixed(2)}<span class="muted"> / ${esc(p.unit)}</span></td>
      <td>${p.badge ? `<span class="pill pill--${p.badge}">${p.badge}</span>` : ""}</td>
      <td class="row">
        <button class="btn btn--sm" data-edit="${p.id}">Edit</button>
        <button class="btn btn--sm btn--danger" data-del="${p.id}">Delete</button>
      </td></tr>`,
    )
    .join("");
  return table(["", "Name", "Category", "Price", "Badge", ""], rows);
}

function formProduct(p: Partial<Product>): string {
  const opts = DB.categories
    .map((c) => `<option value="${c.id}" ${c.id === p.categoryId ? "selected" : ""}>${esc(c.name || c.id)}</option>`)
    .join("");
  return `<form class="form" data-form="products">
    ${input("Name (English)", "name", p.name || "", "text", "required")}
    ${langNames((p.names as Record<string, string>) || {})}
    <div class="grid2">
      <label class="fld"><span>Category</span><select data-field="categoryId">${opts}</select></label>
      <label class="fld"><span>Badge</span><select data-field="badge">
        ${["", "new", "popular", "sale"].map((b) => `<option value="${b}" ${b === (p.badge || "") ? "selected" : ""}>${b || "- none-"}</option>`).join("")}
      </select></label>
    </div>
    <div class="grid2">
      ${input("Price (CAD)", "price", p.price ?? "", "number", 'step="0.01" min="0" required')}
      ${input("Unit (e.g. 100 g, 2 L, ea)", "unit", p.unit || "ea")}
    </div>
    ${input("Was-price (optional, shows a strike-through)", "wasPrice", p.wasPrice ?? "", "number", 'step="0.01" min="0"')}
    ${imageField("Photo", "image", p.image || "")}
    ${formFoot(p.id)}
  </form>`;
}

function listCategories(): string {
  const rows = filterList(DB.categories, (c) =>
    [c.name || "", c.id, ...Object.values(c.names || {})].join(" "),
  )
    .map(
      (c) => `<tr>
      <td><img class="thumb" src="${esc(c.image)}" alt="" /></td>
      <td><b>${esc(c.name || c.id)}</b></td>
      <td class="muted">${esc(c.id)}</td>
      <td><span class="thumb" style="background:${esc(c.tint)};width:22px;height:22px;display:inline-block"></span></td>
      <td>${DB.products.filter((p) => p.categoryId === c.id).length} items</td>
      <td class="row">
        <button class="btn btn--sm" data-edit="${c.id}">Edit</button>
        <button class="btn btn--sm btn--danger" data-del="${c.id}">Delete</button>
      </td></tr>`,
    )
    .join("");
  return table(["", "Name", "Slug", "Tint", "Items", ""], rows);
}

function formCategory(c: Partial<Category>): string {
  const isNew = view.editing === "new";
  return `<form class="form" data-form="categories">
    ${input("Name (English)", "name", c.name || "", "text", "required")}
    ${langNames((c.names as Record<string, string>) || {})}
    <div class="grid2">
      ${input("Slug (id)", "id", c.id || "", "text", isNew ? "" : "readonly")}
      <label class="fld"><span>Tint colour</span><input class="tint" data-field="tint" type="color" value="${esc(c.tint || "#f0e2cc")}" /></label>
    </div>
    ${imageField("Tile image", "image", c.image || "")}
    ${formFoot(isNew ? undefined : c.id)}
  </form>`;
}

function listStores(): string {
  const rows = filterList(DB.stores, (s) =>
    [s.name, s.address, s.phone, ...Object.values(s.names || {})].join(" "),
  )
    .map(
      (s) => `<tr>
      <td><b>${esc(s.name)}</b></td>
      <td class="muted">${esc(s.address)}</td>
      <td>${esc(s.phone)}</td>
      <td class="muted">${esc(s.monSat)} · ${esc(s.sun)}</td>
      <td class="row">
        <button class="btn btn--sm" data-edit="${s.id}">Edit</button>
        <button class="btn btn--sm btn--danger" data-del="${s.id}">Delete</button>
      </td></tr>`,
    )
    .join("");
  return table(["Name", "Address", "Phone", "Hours", ""], rows);
}

function formStore(s: Partial<StoreInfo>): string {
  const isNew = view.editing === "new";
  return `<form class="form" data-form="stores">
    ${input("Name (English)", "name", s.name || "", "text", "required")}
    ${langNames((s.names as Record<string, string>) || {})}
    ${input("Full address", "address", s.address || "", "text", "required")}
    <div class="grid2">
      ${input("Phone", "phone", s.phone || "")}
      ${input("Slug (id)", "id", s.id || "", "text", isNew ? "" : "readonly")}
    </div>
    <div class="grid2">
      ${input("Mon–Sat hours", "monSat", s.monSat || "")}
      ${input("Sun hours", "sun", s.sun || "")}
    </div>
    ${formFoot(isNew ? undefined : s.id)}
  </form>`;
}

function listSlides(): string {
  const rows = filterList(DB.slides, (s) =>
    [slideField(s, "title", "en"), slideField(s, "sub", "en"), slideField(s, "cta", "en")].join(" "),
  )
    .map(
      (s, i) => `<tr>
      <td>${s.bg ? `<img class="thumb" src="${esc(s.bg)}" alt="" />` : '<span class="muted">gradient</span>'}</td>
      <td><b>${esc(slideField(s, "title", "en")) || "(untitled)"}</b><br><span class="muted">${esc(slideField(s, "sub", "en"))}</span></td>
      <td>${i + 1}</td>
      <td class="row">
        <button class="btn btn--sm" data-edit="${s.id}">Edit</button>
        <button class="btn btn--sm btn--danger" data-del="${s.id}">Delete</button>
      </td></tr>`,
    )
    .join("");
  return table(["BG", "Slide", "#", ""], rows);
}

function formSlide(s: Partial<Slide>): string {
  const ph = (f: "title" | "sub" | "cta") =>
    s.id ? `placeholder="${esc(slideField(s as Slide, f, "en"))}"` : "";
  return `<form class="form" data-form="slides">
    <p class="note">Leave a field blank to keep the default translated text. Type to override it (then it shows as-is in every language).</p>
    ${input("Heading", "title", s.title || "", "text", ph("title"))}
    ${input("Sub-text", "sub", s.sub || "", "text", ph("sub"))}
    ${input("Button label", "cta", s.cta || "", "text", ph("cta"))}
    ${imageField("Background image (optional)", "bg", s.bg || "")}
    ${formFoot(s.id)}
  </form>`;
}

// ── Orders ───────────────────────────────────────────────────────
function orderItemsCount(o: Order): number {
  return o.items.reduce((s, i) => s + i.qty, 0);
}

function statusBadge(s: OrderStatus): string {
  return `<span class="ostatus ostatus--${s}">${STATUS_LABEL[s]}</span>`;
}

function ordersTopbar(): string {
  const opts = ["all", ...ORDER_STATUSES]
    .map(
      (s) =>
        `<option value="${s}" ${s === view.statusFilter ? "selected" : ""}>${s === "all" ? "All statuses" : STATUS_LABEL[s as OrderStatus]}</option>`,
    )
    .join("");
  return `<div class="topbar__tools topbar__tools--filters">
    <input class="search-input" data-search type="search" autocomplete="off" placeholder="Search orders…" value="${esc(view.query)}" />
    <select class="search-input" data-status-filter>${opts}</select>
  </div>`;
}

function listOrders(): string {
  let list = DB.orders;
  if (view.statusFilter !== "all") list = list.filter((o) => o.status === view.statusFilter);
  list = filterList(list, (o) =>
    [o.id, o.customer.name, o.customer.email, o.customer.phone, o.fulfillment, o.storeName || ""].join(" "),
  );
  const rows = list
    .map(
      (o) => `<tr class="orow" data-edit="${o.id}">
      <td><b>${esc(o.id)}</b></td>
      <td class="muted">${esc(fmtDate(o.createdAt))}</td>
      <td>${esc(o.customer.name)}<br><span class="muted">${o.fulfillment === "pickup" ? "Pickup · " + esc(o.storeName || "") : "Local delivery"}</span></td>
      <td>${orderItemsCount(o)}</td>
      <td><b>${fmtMoney(o.total)}</b></td>
      <td>${statusBadge(o.status)}</td>
      <td class="row"><button class="btn btn--sm" data-edit="${o.id}">View</button></td>
    </tr>`,
    )
    .join("");
  if (!rows) {
    const filtered = view.query.trim() || view.statusFilter !== "all";
    const msg = filtered
      ? "No orders match your search."
      : "No orders yet - they'll appear here as customers check out.";
    return `<div class="card"><div class="empty">${msg}</div></div>`;
  }
  return table(["Order", "Date", "Customer", "Items", "Total", "Status", ""], rows);
}

function formOrder(o: Order | undefined): string {
  if (!o) return `<div class="card"><div class="empty">Order not found.</div></div>`;
  const cust =
    o.fulfillment === "pickup"
      ? `<p><b>Pickup</b> at ${esc(o.storeName || "")}</p>`
      : `<p><b>Local delivery</b><br>${esc(o.customer.address || "")}<br>${esc([o.customer.city, o.customer.postal].filter(Boolean).join(" "))}</p>`;
  const itemRows = o.items
    .map(
      (it) => `<tr>
      <td><img class="thumb" src="${esc(it.image)}" alt="" /></td>
      <td>${esc(it.name)}</td>
      <td class="muted">${esc(it.unit)}</td>
      <td>${fmtMoney(it.price)}</td>
      <td>×${it.qty}</td>
      <td><b>${fmtMoney(it.price * it.qty)}</b></td>
    </tr>`,
    )
    .join("");
  const statusOpts = ORDER_STATUSES.map(
    (s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${STATUS_LABEL[s]}</option>`,
  ).join("");

  return `<form class="form orderview" data-form="orders">
    <div class="orderview__top">
      <div>
        <div class="orderview__ref">${esc(o.id)}</div>
        <div class="muted">${esc(fmtDate(o.createdAt))} · ${o.lang.toUpperCase()}</div>
      </div>
      ${statusBadge(o.status)}
    </div>

    <div class="grid2">
      <div class="panelbox">
        <h4>Customer</h4>
        <p>${esc(o.customer.name)}</p>
        <p><a href="mailto:${esc(o.customer.email)}">${esc(o.customer.email)}</a></p>
        <p><a href="tel:${esc(o.customer.phone.replace(/[^\d+]/g, ""))}">${esc(o.customer.phone)}</a></p>
        ${cust}
        ${o.customer.notes ? `<p class="muted"><b>Notes:</b> ${esc(o.customer.notes)}</p>` : ""}
      </div>
      <div class="panelbox">
        <h4>Payment</h4>
        <p>${esc(o.payment.brand)} ····&nbsp;${esc(o.payment.last4)} ${
          o.payment.mode === "live"
            ? `<span class="pill pill--live">${esc(providerLabel(o.payment.provider || ""))}</span>`
            : `<span class="pill">demo</span>`
        }</p>
        <dl class="paydl">
          <div><dt>Subtotal</dt><dd>${fmtMoney(o.subtotal)}</dd></div>
          <div><dt>${o.fulfillment === "pickup" ? "Pickup" : "Delivery"}</dt><dd>${o.shipping ? fmtMoney(o.shipping) : "Free"}</dd></div>
          <div><dt>HST (15%)</dt><dd>${fmtMoney(o.tax)}</dd></div>
          <div class="paydl__grand"><dt>Total</dt><dd>${fmtMoney(o.total)}</dd></div>
        </dl>
      </div>
    </div>

    <div class="panelbox">
      <h4>Items (${orderItemsCount(o)})</h4>
      <table class="orderitems">
        <tbody>${itemRows}</tbody>
      </table>
    </div>

    <div class="grid2">
      <label class="fld"><span>Order status</span>
        <select data-field="status">${statusOpts}</select>
      </label>
    </div>
    ${formFoot(o.id)}
  </form>`;
}

// ── Dashboard ────────────────────────────────────────────────────
function dashboardPanel(): string {
  const orders = DB.orders;
  if (orders.length === 0) {
    return `<div class="dash-empty">
      <span class="dash-empty__ic">${icon("receipt", 40)}</span>
      <h3>No orders yet</h3>
      <p class="muted">Sales figures and charts appear here automatically as customers place orders through the storefront checkout.</p>
      <a class="btn btn--primary" href="/">Open storefront</a>
    </div>`;
  }
  const paid = orders.filter((o) => o.status !== "cancelled");
  const revenue = paid.reduce((s, o) => s + o.total, 0);
  const itemsSold = paid.reduce((s, o) => s + orderItemsCount(o), 0);
  const aov = paid.length ? revenue / paid.length : 0;

  const DAY = 86_400_000;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime() - 13 * DAY;
  const buckets = new Array(14).fill(0);
  const labels: string[] = [];
  for (let i = 0; i < 14; i++)
    labels.push(new Date(startMs + i * DAY).toLocaleDateString(undefined, { day: "numeric" }));
  for (const o of paid) {
    const d = Math.floor((o.createdAt - startMs) / DAY);
    if (d >= 0 && d < 14) buckets[d] += o.total;
  }
  const max = Math.max(1, ...buckets);

  const weekStart = start.getTime() - 6 * DAY;
  const todayCount = orders.filter((o) => o.createdAt >= start.getTime()).length;
  const weekRevenue = paid.filter((o) => o.createdAt >= weekStart).reduce((s, o) => s + o.total, 0);
  const toFulfill = orders.filter((o) => ["new", "preparing", "ready"].includes(o.status)).length;

  // Top products by revenue
  const tally = new Map<string, { name: string; qty: number; rev: number }>();
  for (const o of paid)
    for (const it of o.items) {
      const e = tally.get(it.id) ?? { name: it.name, qty: 0, rev: 0 };
      e.qty += it.qty;
      e.rev += it.price * it.qty;
      tally.set(it.id, e);
    }
  const top = [...tally.values()].sort((a, b) => b.rev - a.rev).slice(0, 5);
  const topMax = Math.max(1, ...top.map((t) => t.rev));

  const statusCounts = ORDER_STATUSES.map((s) => ({ s, n: orders.filter((o) => o.status === s).length }));
  const recent = orders.slice(0, 6);

  const kpi = (ic: string, label: string, value: string, sub: string) => `
    <div class="kpi">
      <span class="kpi__ic">${icon(ic, 20)}</span>
      <div class="kpi__body">
        <span class="kpi__label">${label}</span>
        <span class="kpi__val">${value}</span>
        <span class="kpi__sub">${sub}</span>
      </div>
    </div>`;

  return `
    <div class="kpis">
      ${kpi("chart", "Revenue", fmtMoney(revenue), `${fmtMoney(weekRevenue)} this week`)}
      ${kpi("receipt", "Orders", String(orders.length), `${todayCount} today`)}
      ${kpi("card", "Avg. order", fmtMoney(aov), `${paid.length} paid`)}
      ${kpi("bag", "Items sold", String(itemsSold), `${toFulfill} to fulfil`)}
    </div>

    <div class="dash-card">
      <div class="dash-card__head"><h3>Revenue · last 14 days</h3><span class="muted">${fmtMoney(revenue)}</span></div>
      <div class="chart">
        ${buckets
          .map(
            (v, i) =>
              `<div class="chart__col"><span class="chart__bar" style="height:${Math.max(2, Math.round((v / max) * 100))}%" title="${esc(labels[i])}: ${fmtMoney(v)}"></span><span class="chart__x">${esc(labels[i])}</span></div>`,
          )
          .join("")}
      </div>
    </div>

    <div class="dash-grid">
      <div class="dash-card">
        <h3>Top products</h3>
        ${
          top.length
            ? top
                .map(
                  (t) => `<div class="toprow">
                    <span class="toprow__name">${esc(t.name)}</span>
                    <span class="toprow__bar"><span style="width:${Math.round((t.rev / topMax) * 100)}%"></span></span>
                    <span class="toprow__val">${fmtMoney(t.rev)} <small class="muted">${t.qty}×</small></span>
                  </div>`,
                )
                .join("")
            : '<p class="muted">No sales yet.</p>'
        }
      </div>
      <div class="dash-card">
        <h3>Order status</h3>
        ${statusCounts
          .map(({ s, n }) => `<div class="statrow">${statusBadge(s)}<b>${n}</b></div>`)
          .join("")}
      </div>
    </div>

    <div class="dash-card">
      <div class="dash-card__head"><h3>Recent orders</h3><button class="btn btn--sm" data-nav="orders">View all</button></div>
      <table>
        <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>
          ${recent
            .map(
              (o) => `<tr class="orow" data-open-order="${o.id}">
                <td><b>${esc(o.id)}</b></td>
                <td class="muted">${esc(fmtDate(o.createdAt))}</td>
                <td>${esc(o.customer.name)}</td>
                <td><b>${fmtMoney(o.total)}</b></td>
                <td>${statusBadge(o.status)}</td>
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

// ── Payments ─────────────────────────────────────────────────────
function paymentsPanel(): string {
  const cfg = payCfg;
  const selected = payForm.provider || cfg?.provider || "";
  const prov = getProvider(selected);
  const savedForThis = cfg && cfg.provider === selected ? cfg : null;
  const envs = prov?.environments ?? [];
  const selectedEnv = payForm.environment || savedForThis?.environment || envs[0]?.value || "";

  // Status: live only when saved + enabled + fully configured; otherwise demo.
  let status: string;
  if (savedForThis?.live) {
    status = `<span class="pay-badge pay-badge--live">${icon("card", 14)} Live · ${esc(providerLabel(cfg!.provider))} (${esc(cfg!.environment)})</span>`;
  } else if (savedForThis?.enabled && savedForThis?.provider) {
    status = `<span class="pay-badge pay-badge--warn">Enabled, but required fields are missing — still demo</span>`;
  } else {
    status = `<span class="pay-badge pay-badge--demo">Demo mode</span>`;
  }

  const providerOpts = [
    `<option value="">— Demo mode (no live processor) —</option>`,
    ...PAYMENT_PROVIDERS.map(
      (p) => `<option value="${p.id}" ${p.id === selected ? "selected" : ""}>${esc(p.label)}</option>`,
    ),
  ].join("");

  let body = "";
  if (prov) {
    const envOpts = envs
      .map((e) => `<option value="${e.value}" ${e.value === selectedEnv ? "selected" : ""}>${esc(e.label)}</option>`)
      .join("");
    const fields = prov.fields
      .map((f) => {
        const val = !f.secret ? esc(savedForThis?.values?.[f.key] ?? "") : "";
        const isSet = f.secret && !!savedForThis?.secretsSet?.[f.key];
        const ph = f.secret && isSet ? "•••••••• saved — leave blank to keep" : esc(f.placeholder || "");
        const tags = `${f.required ? ' <em class="req">*</em>' : ""}${f.secret ? ' <span class="pill">secret</span>' : ""}`;
        return `<label class="fld"><span>${esc(f.label)}${tags}</span>
          <input data-pay-field="${f.key}" type="${f.secret ? "password" : "text"}"
                 value="${val}" placeholder="${ph}" autocomplete="off" spellcheck="false" /></label>`;
      })
      .join("");
    body = `
      ${prov.note ? `<p class="note">${esc(prov.note)}</p>` : ""}
      <div class="grid2">
        <label class="fld"><span>Environment</span><select data-pay="environment">${envOpts}</select></label>
        <label class="fld pay-enable"><span>Enable live payments</span>
          <input type="checkbox" data-pay="enabled" ${savedForThis?.enabled ? "checked" : ""} />
        </label>
      </div>
      ${fields}`;
  }

  return `<div class="form paycfg">
    <div class="pay-status">${status}</div>
    <p class="muted">Choose one processor and enter its credentials. If none is enabled and fully configured, checkout automatically stays in the existing demo mode.</p>
    <label class="fld"><span>Payment processor</span>
      <select data-pay="provider">${providerOpts}</select>
    </label>
    ${body}
    <p class="pay-secure note">${icon("lock", 14)} Credentials are stored on the server, never in this browser. Saved secret keys are kept when you leave their field blank.</p>
    <div class="formfoot">
      <span></span>
      <div class="row">
        <button type="button" class="btn btn--primary" data-act="save-payments">Save payment settings</button>
      </div>
    </div>
  </div>`;
}

function settings(): string {
  return `<div class="form">
    <h3>Backup &amp; restore</h3>
    <p class="muted">All edits are stored in this browser. Export a JSON backup to keep it safe or hand it back to migrate to a shared database later.</p>
    <div class="row" style="margin:14px 0 22px">
      <button class="btn btn--primary" data-act="export">Export JSON</button>
      <label class="btn">Import JSON<input type="file" accept="application/json" data-act="import" hidden /></label>
      <button class="btn btn--danger" data-act="reset">Reset to defaults</button>
    </div>
    <h3>How it works</h3>
    <p class="muted" style="font-size:.9rem">This tool edits the catalog the storefront reads. Changes appear on the storefront after a reload. It is unlinked from the public site -BE bookmark this page. (Production note: to make edits visible to <em>all</em> visitors, point the CMS read/write helpers at Cloud Firestore.)</p>
  </div>`;
}

function table(heads: string[], rows: string): string {
  if (!rows) {
    const msg = view.query.trim()
      ? `No matches for “${esc(view.query.trim())}”.`
      : "Nothing here yet- click “+ New”.";
    return `<div class="card"><div class="empty">${msg}</div></div>`;
  }
  return `<div class="card"><table>
    <thead><tr>${heads.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function formFoot(id?: string): string {
  return `<div class="formfoot">
    <button type="button" class="btn btn--danger" data-act="${id ? "delete" : "cancel"}">${id ? "Delete" : "Cancel"}</button>
    <div class="row">
      <button type="button" class="btn" data-act="cancel">Cancel</button>
      <button type="submit" class="btn btn--primary">Save</button>
    </div>
  </div>`;
}

function find<T extends { id: string }>(arr: T[], id: string): T | undefined {
  return arr.find((x) => x.id === id);
}

function mainPanel(): string {
  const s = view.section;
  if (s === "settings") return header("Settings", "Backup, restore, and notes") + settings();
  if (s === "payments")
    return header("Payments", "Configure a live card processor, or stay in demo mode") + paymentsPanel();
  if (s === "dashboard") return header("Dashboard", "Sales overview & store performance") + dashboardPanel();

  const titles: Record<string, [string, string]> = {
    orders: ["Orders", "Track and fulfil customer orders"],
    products: ["Items", "Add and edit products"],
    categories: ["Categories", "Group items into shoppable sections"],
    stores: ["Locations", "Store addresses, phone and hours"],
    slides: ["Carousel", "Homepage hero slides (supports image backgrounds)"],
  };
  const [title, sub] = titles[s];

  if (view.editing) {
    if (s === "orders") {
      const o = find(DB.orders, view.editing as string);
      return header(`Order ${esc(view.editing as string)}`, sub) + formOrder(o);
    }
    const editingNew = view.editing === "new";
    const heading = `${editingNew ? "New" : "Edit"} ${title.replace(/s$/, "").toLowerCase()}`;
    let form = "";
    if (s === "products") form = formProduct(editingNew ? {} : find(DB.products, view.editing) || {});
    if (s === "categories") form = formCategory(editingNew ? {} : find(DB.categories, view.editing) || {});
    if (s === "stores") form = formStore(editingNew ? {} : find(DB.stores, view.editing) || {});
    if (s === "slides") form = formSlide(editingNew ? {} : find(DB.slides, view.editing) || {});
    return header(heading, sub) + form;
  }

  if (s === "orders")
    return header(title, sub) + ordersTopbar() + `<div id="admin-list">${listOrders()}</div>`;

  return header(title, sub, true) + `<div id="admin-list">${currentList()}</div>`;
}

/** The list table for the current section (used on first render and on search). */
function currentList(): string {
  switch (view.section) {
    case "orders":
      return listOrders();
    case "products":
      return listProducts();
    case "categories":
      return listCategories();
    case "stores":
      return listStores();
    default:
      return listSlides();
  }
}

function header(title: string, sub: string, isList = false): string {
  const tools = isList
    ? `<div class="topbar__tools">
        <input class="search-input" data-search type="search" autocomplete="off"
               placeholder="Search ${esc(title.toLowerCase())}…" value="${esc(view.query)}" />
        <button class="btn btn--primary" data-act="new">+ New</button>
      </div>`
    : "";
  return `<div class="topbar">
    <div><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></div>
    ${tools}
  </div>`;
}

function render(): void {
  app.className = "app";
  app.innerHTML = sidebar() + `<main class="main">${mainPanel()}</main>`;
}

// ── persistence per section ──────────────────────────────────────
function persist(section: Section): void {
  if (section === "products") saveProducts(DB.products);
  if (section === "categories") saveCategories(DB.categories);
  if (section === "stores") saveStores(DB.stores);
  if (section === "slides") saveSlides(DB.slides);
  if (section === "orders") saveOrders(DB.orders);
}

function readForm(form: HTMLFormElement): Record<string, any> {
  const obj: Record<string, any> = {};
  form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]").forEach((el) => {
    const path = el.dataset.field!.split(".");
    let value: any = el.value.trim();
    if ((el as HTMLInputElement).type === "number") value = value === "" ? undefined : Number(value);
    if (value === "") value = undefined;
    let o = obj;
    for (let i = 0; i < path.length - 1; i++) o = o[path[i]] ??= {};
    o[path[path.length - 1]] = value;
  });
  return obj;
}

function cleanNames(names?: Record<string, string>): Record<string, string> | undefined {
  if (!names) return undefined;
  const out: Record<string, string> = {};
  for (const k in names) if (names[k]) out[k] = names[k];
  return Object.keys(out).length ? out : undefined;
}

function saveForm(form: HTMLFormElement): void {
  const s = view.section;
  const d = readForm(form);
  const editingNew = view.editing === "new";

  if (s === "products") {
    if (!d.name || d.price == null) return toast("Name and price are required");
    const existing = editingNew ? undefined : find(DB.products, view.editing as string);
    const p: Product = {
      id: existing?.id ?? uid("p"),
      name: d.name,
      names: cleanNames(d.names),
      categoryId: d.categoryId || DB.categories[0]?.id || "",
      price: Number(d.price),
      unit: d.unit || "ea",
      image: d.image || "",
      badge: d.badge || undefined,
      wasPrice: d.wasPrice,
    };
    upsert(DB.products, p);
  } else if (s === "categories") {
    if (!d.name) return toast("Name is required");
    const existing = editingNew ? undefined : find(DB.categories, view.editing as string);
    const c: Category = {
      id: existing?.id ?? slug(d.id || d.name),
      name: d.name,
      names: cleanNames(d.names),
      image: d.image || "",
      tint: d.tint || "#f0e2cc",
    };
    upsert(DB.categories, c);
  } else if (s === "stores") {
    if (!d.name || !d.address) return toast("Name and address are required");
    const existing = editingNew ? undefined : find(DB.stores, view.editing as string);
    const st: StoreInfo = {
      id: existing?.id ?? slug(d.id || d.name),
      name: d.name,
      names: cleanNames(d.names),
      address: d.address,
      phone: d.phone || "",
      monSat: d.monSat || "",
      sun: d.sun || "",
    };
    upsert(DB.stores, st);
  } else if (s === "slides") {
    const existing = editingNew ? undefined : find(DB.slides, view.editing as string);
    const sl: Slide = {
      ...(existing || { id: uid("s") }),
      title: d.title,
      sub: d.sub,
      cta: d.cta,
      bg: d.bg,
    };
    upsert(DB.slides, sl);
  } else if (s === "orders") {
    const existing = find(DB.orders, view.editing as string);
    if (!existing) return;
    if (d.status) existing.status = d.status as OrderStatus;
    updateOrder(existing.id, { status: existing.status }); // localStorage + Firestore
    view.editing = null;
    render();
    return toast("Saved");
  }

  persist(s);
  view.editing = null;
  render();
  toast("Saved");
}

function upsert<T extends { id: string }>(arr: T[], item: T): void {
  const i = arr.findIndex((x) => x.id === item.id);
  if (i >= 0) arr[i] = item;
  else arr.push(item);
}

function removeItem(section: Section, id: string): void {
  const arr =
    section === "products"
      ? DB.products
      : section === "categories"
        ? DB.categories
        : section === "stores"
          ? DB.stores
          : section === "orders"
            ? DB.orders
            : DB.slides;
  const i = (arr as { id: string }[]).findIndex((x) => x.id === id);
  if (i >= 0) arr.splice(i, 1);
  persist(section);
  // Orders also live in Firestore - remove the remote doc.
  if (section === "orders") removeOrder(id);
}

// ── Payments: collect the form and persist to the server ─────────
async function savePayments(): Promise<void> {
  const panel = document.querySelector<HTMLElement>(".paycfg");
  if (!panel) return;
  const provider = (panel.querySelector('[data-pay="provider"]') as HTMLSelectElement | null)?.value || "";

  if (!provider) {
    // "Demo mode" chosen: disable any live processor.
    const res = await savePaymentConfig({ provider: "", enabled: false, environment: "", values: {} });
    if (!res.ok) return toast("Save failed — check the wrapper API key");
    payCfg = await fetchPaymentConfig();
    payForm.provider = "";
    render();
    return toast("Saved — checkout stays in demo mode");
  }

  const environment = (panel.querySelector('[data-pay="environment"]') as HTMLSelectElement | null)?.value || "";
  const enabled = (panel.querySelector('[data-pay="enabled"]') as HTMLInputElement | null)?.checked ?? false;
  const values: Record<string, string> = {};
  panel.querySelectorAll<HTMLInputElement>("[data-pay-field]").forEach((el) => {
    values[el.dataset.payField!] = el.value.trim();
  });

  const res = await savePaymentConfig({ provider, enabled, environment, values });
  if (!res.ok) return toast("Save failed — check the wrapper API key");
  payCfg = await fetchPaymentConfig();
  payForm.provider = "";
  payForm.environment = "";
  render();
  toast(
    res.live
      ? "Live payments enabled"
      : enabled
        ? "Saved — fill required fields to go live"
        : "Saved — checkout stays in demo mode",
  );
}

// ── events ───────────────────────────────────────────────────────
document.addEventListener("click", (e) => {
  const el = e.target as HTMLElement;
  const nav = el.closest<HTMLElement>("[data-nav]");
  if (nav) {
    view.section = nav.dataset.nav as Section;
    view.editing = null;
    view.query = "";
    view.statusFilter = "all";
    payForm.provider = "";
    payForm.environment = "";
    return render();
  }
  const openOrder = el.closest<HTMLElement>("[data-open-order]")?.dataset.openOrder;
  if (openOrder) {
    view.section = "orders";
    view.editing = openOrder;
    view.query = "";
    view.statusFilter = "all";
    return render();
  }
  const act = el.closest<HTMLElement>("[data-act]")?.dataset.act;
  const edit = el.closest<HTMLElement>("[data-edit]")?.dataset.edit;
  const del = el.closest<HTMLElement>("[data-del]")?.dataset.del;

  if (edit) {
    view.editing = edit;
    return render();
  }
  if (del) {
    if (confirm("Delete this item?")) {
      removeItem(view.section, del);
      render();
      toast("Deleted");
    }
    return;
  }
  if (act === "new") {
    view.editing = "new";
    return render();
  }
  if (act === "cancel") {
    view.editing = null;
    return render();
  }
  if (act === "delete") {
    if (view.editing && view.editing !== "new" && confirm("Delete this item?")) {
      removeItem(view.section, view.editing);
      view.editing = null;
      render();
      toast("Deleted");
    }
    return;
  }
  if (act === "save-payments") {
    void savePayments();
    return;
  }
  if (act === "export") return download("enm-content.json", exportData());
  if (act === "logout") {
    if (confirm("Sign out of the admin?")) signOutAdmin();
    return;
  }
  if (act === "reset") {
    if (confirm("Discard all edits and restore the original catalog?")) {
      resetAll();
      location.reload();
    }
  }
});

document.addEventListener("submit", (e) => {
  const form = (e.target as HTMLElement).closest<HTMLFormElement>("form[data-form]");
  if (!form) return;
  e.preventDefault();
  saveForm(form);
});

// Live search- refresh only the table so the search box keeps focus.
document.addEventListener("input", (e) => {
  const el = e.target as HTMLElement;
  if (!el.matches("[data-search]")) return;
  view.query = (el as HTMLInputElement).value;
  const list = document.getElementById("admin-list");
  if (list) list.innerHTML = currentList();
});

// Image uploads (downscaled to a data URL) + JSON import.
document.addEventListener("change", async (e) => {
  const el = e.target as HTMLInputElement;
  // Payments: switching provider re-renders the field set; env is just stored.
  if (el.matches('[data-pay="provider"]')) {
    payForm.provider = el.value;
    payForm.environment = "";
    return render();
  }
  if (el.matches('[data-pay="environment"]')) {
    payForm.environment = el.value;
    return;
  }
  if (el.matches("[data-status-filter]")) {
    view.statusFilter = el.value as OrderStatus | "all";
    const list = document.getElementById("admin-list");
    if (list) list.innerHTML = currentList();
    return;
  }
  if (el.matches("[data-img-file]") && el.files?.[0]) {
    const url = await fileToDataURL(el.files[0]);
    const wrap = el.closest(".imgfield")!;
    (wrap.querySelector("input[data-field]") as HTMLInputElement).value = url;
    const prev = wrap.querySelector(".imgprev") as HTMLImageElement;
    prev.src = url;
    prev.hidden = false;
  }
  if (el.matches('[data-act="import"]') && el.files?.[0]) {
    const text = await el.files[0].text();
    try {
      importData(text);
      location.reload();
    } catch {
      toast("Invalid JSON file");
    }
  }
});

// ── Boot: gate the admin behind authentication, load the live catalog, start ──
let started = false;
async function startAdmin(): Promise<void> {
  // Pull the live catalog from Counterpoint so Items/Categories/Locations show
  // real data; orders come from the local log (the storefront's source of truth).
  await loadCatalog();
  loadDB();
  payCfg = await fetchPaymentConfig(); // secret-free view of the saved processor
  render();
  if (started) return;
  started = true;
  // Live order updates from Firestore (no-op in local mode). Refresh the local
  // cache and re-render the relevant view, unless mid-edit.
  subscribeOrders(() => {
    DB.orders = clone(getOrders()) as Order[];
    if (!view.editing && (view.section === "orders" || view.section === "dashboard")) render();
  });
}

requireAuth(() => void startAdmin());

// ── PWA: the admin is part of the app, so it registers the service worker too
// (offline-capable, auto-updates, installable when opened directly at /admin). ──
import("virtual:pwa-register")
  .then(({ registerSW }) => {
    const updateSW = registerSW({
      onNeedRefresh() {
        toast("New version- updating…");
        updateSW(true);
      },
      onOfflineReady() {
        toast("Admin ready to work offline");
      },
    });
  })
  .catch(() => {
    /* SW unavailable in this context- ignore. */
  });
