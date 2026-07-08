import type { LangCode } from "../data/types";

export interface State {
  lang: LangCode;
  /** Active category filter, or "all". */
  category: string;
  /** Free-text search query. */
  query: string;
  /** 1-based product page (desktop pagination only; mobile shows all). */
  productPage: number;
  /** productId -> quantity. */
  cart: Record<string, number>;
  cartOpen: boolean;
  menuOpen: boolean;
  locationsOpen: boolean;
  checkoutOpen: boolean;
  /** Open info page id ("about" | "delivery" | "returns"), or null. */
  page: string | null;
}

type Listener = (state: State) => void;

const CART_KEY = "store.cart";

function loadCart(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

const listeners = new Set<Listener>();

export const state: State = {
  lang: "en",
  category: "all",
  query: "",
  productPage: 1,
  cart: loadCart(),
  cartOpen: false,
  menuOpen: false,
  locationsOpen: false,
  checkoutOpen: false,
  page: null,
};

function emit(): void {
  for (const l of listeners) l(state);
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── Mutations ────────────────────────────────────────────────────
export function setCategory(category: string): void {
  state.category = category;
  state.productPage = 1; // new filter -> back to the first page
  emit();
}

export function setQuery(query: string): void {
  state.query = query;
  state.productPage = 1; // new search -> back to the first page
  emit();
}

export function setProductPage(page: number): void {
  state.productPage = Math.max(1, page);
  emit();
}

export function addToCart(id: string, delta = 1): void {
  const next = (state.cart[id] ?? 0) + delta;
  if (next <= 0) delete state.cart[id];
  else state.cart[id] = next;
  persistCart();
  emit();
}

export function removeFromCart(id: string): void {
  delete state.cart[id];
  persistCart();
  emit();
}

export function clearCart(): void {
  state.cart = {};
  persistCart();
  emit();
}

export function setCartOpen(open: boolean): void {
  state.cartOpen = open;
  if (open) {
    state.menuOpen = false;
    state.locationsOpen = false;
    state.page = null;
  }
  emit();
}

export function setCheckoutOpen(open: boolean): void {
  state.checkoutOpen = open;
  if (open) {
    state.cartOpen = false;
    state.menuOpen = false;
    state.locationsOpen = false;
    state.page = null;
  }
  emit();
}

export function setMenuOpen(open: boolean): void {
  state.menuOpen = open;
  if (open) state.page = null;
  emit();
}

export function setLocationsOpen(open: boolean): void {
  state.locationsOpen = open;
  if (open) {
    state.menuOpen = false;
    state.cartOpen = false;
    state.page = null;
  }
  emit();
}

export function setPage(id: string | null): void {
  state.page = id;
  if (id) {
    state.menuOpen = false;
    state.cartOpen = false;
    state.locationsOpen = false;
  }
  emit();
}

function persistCart(): void {
  localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
}

// ── Derived selectors ────────────────────────────────────────────
export function cartCount(): number {
  let n = 0;
  for (const id in state.cart) n += state.cart[id];
  return n;
}
