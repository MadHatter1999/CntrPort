import type { LangCode } from "./types";
import { remoteUpsert, remoteDelete, remoteSubscribe } from "./remote";

const COLL = "orders";

/**
 * Order capture + tracking. The storefront's checkout writes orders here; the
 * admin tool reads them for the sales dashboard and order tracking. Like the
 * CMS, this is backend-agnostic localStorage - swap the read/write helpers for
 * Firestore later and nothing else changes.
 */
const KEY = "store.orders.v1";

/** Flat delivery fee applied when the shopper chooses delivery over pickup.
 *  0 = free delivery. Adjust for your store. (Tax comes from the store config.) */
export const SHIPPING_FLAT = 0;

export type Fulfillment = "pickup" | "shipping";

/** Lifecycle a store clerk moves an order through. */
export type OrderStatus = "new" | "preparing" | "ready" | "completed" | "cancelled";

export const ORDER_STATUSES: OrderStatus[] = [
  "new",
  "preparing",
  "ready",
  "completed",
  "cancelled",
];

export interface OrderItem {
  id: string;
  /** Name snapshot at purchase time (English; stays stable if the catalog changes). */
  name: string;
  price: number;
  unit: string;
  qty: number;
  image: string;
}

export interface OrderCustomer {
  name: string;
  email: string;
  phone: string;
  /** Shipping only. */
  address?: string;
  city?: string;
  postal?: string;
  notes?: string;
}

export interface Order {
  /** Friendly, unique reference, e.g. "WEB-1042". */
  id: string;
  /** Epoch ms the order was placed. */
  createdAt: number;
  status: OrderStatus;
  fulfillment: Fulfillment;
  /** Pickup store id (pickup only). */
  storeId?: string;
  storeName?: string;
  customer: OrderCustomer;
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  /** Card payment. `mode` is "demo" unless a live processor was configured in
   *  the admin at checkout time; `provider` names it when live. */
  payment: { method: "card"; brand: string; last4: string; mode?: "demo" | "live"; provider?: string };
  /** Counterpoint Document id once the order was written back to CP. */
  cpDocId?: string;
  lang: LangCode;
}

// ── storage ──────────────────────────────────────────────────────
function read(): Order[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Order[]) : null;
  } catch {
    return null;
  }
}

function write(orders: Order[]): void {
  localStorage.setItem(KEY, JSON.stringify(orders));
}

/** All real orders, newest first. Empty until customers actually check out. */
export function getOrders(): Order[] {
  return read() ?? [];
}

export function saveOrders(orders: Order[]): void {
  write(orders);
}

/** Append a freshly placed order (newest first) and return it. */
export function addOrder(order: Order): Order {
  const all = getOrders();
  all.unshift(order);
  write(all);
  remoteUpsert(COLL, order.id, order);
  return order;
}

export function updateOrder(id: string, patch: Partial<Order>): void {
  const all = getOrders();
  const i = all.findIndex((o) => o.id === id);
  if (i >= 0) {
    all[i] = { ...all[i], ...patch };
    write(all);
    remoteUpsert(COLL, id, all[i]);
  }
}

export function removeOrder(id: string): void {
  write(getOrders().filter((o) => o.id !== id));
  remoteDelete(COLL, id);
}

/** Live updates from Firestore (admin). Mirrors remote docs into the local
 *  cache and calls `cb`. No-op in local mode. Returns an unsubscribe fn. */
export function subscribeOrders(cb: () => void): () => void {
  return remoteSubscribe<Order>(COLL, (rows) => {
    write(rows);
    cb();
  });
}

export function resetOrders(): void {
  localStorage.removeItem(KEY);
}

/** Next friendly reference (max existing numeric suffix + 1). */
export function nextOrderRef(): string {
  let max = 1000;
  for (const o of getOrders()) {
    const n = Number(o.id.replace(/\D/g, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `WEB-${max + 1}`;
}

/** Guess a card brand from the first digits (display only). */
export function cardBrand(number: string): string {
  const d = number.replace(/\D/g, "");
  if (/^4/.test(d)) return "Visa";
  if (/^5[1-5]/.test(d) || /^2[2-7]/.test(d)) return "Mastercard";
  if (/^3[47]/.test(d)) return "Amex";
  if (/^6/.test(d)) return "Discover";
  return "Card";
}
