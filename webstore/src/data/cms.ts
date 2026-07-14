import { defaultSlides } from "./slides";
import { defaultStores, type StoreInfo } from "./stores";
import type { Category, Product, Slide } from "./types";
import { fetchConfig, fetchCategories, fetchProducts, apiUrl, authHeaders, type StoreConfig } from "./api";

/**
 * Storefront data access. The catalog (categories, products) and store config
 * (name, currency, tax, locations) are read live from Counterpoint via the
 * CntrPort wrapper at startup - call loadCatalog() before the first render.
 *
 * The admin tool can override any collection (carousel slides, hidden
 * locations, category tile images, ...). Those overrides are stored ON THE
 * WRAPPER (/api/store/content) so they apply to every visitor in every
 * browser: loadCatalog() pulls the server overlay at boot, and each admin
 * save pushes back up. localStorage only acts as a warm-start cache of the
 * server copy (and the fallback when the wrapper is unreachable).
 */
const KEY = "store.cms.v1";

export interface CmsData {
  categories?: Category[];
  products?: Product[];
  stores?: StoreInfo[];
  slides?: Slide[];
}

const CONTENT_URL = "/api/store/content";

const DEFAULT_CONFIG: StoreConfig = { name: "Web Store", currency: "USD", taxRate: 0, stores: [] };

// Live catalog pulled from Counterpoint. Empty until loadCatalog() resolves.
let live: { config: StoreConfig; categories: Category[]; products: Product[] } = {
  config: DEFAULT_CONFIG,
  categories: [],
  products: [],
};

// ── server-held overlay ──────────────────────────────────────────
function sanitize(raw: unknown): CmsData {
  const c = (raw ?? {}) as Record<string, unknown>;
  const out: CmsData = {};
  if (Array.isArray(c.categories)) out.categories = c.categories as Category[];
  if (Array.isArray(c.products)) out.products = c.products as Product[];
  if (Array.isArray(c.stores)) out.stores = c.stores as StoreInfo[];
  if (Array.isArray(c.slides)) out.slides = c.slides as Slide[];
  return out;
}

/** Server overlay, or null when the wrapper is unreachable (keep local cache). */
async function fetchRemoteCms(): Promise<CmsData | null> {
  try {
    const res = await fetch(apiUrl(CONTENT_URL), { headers: authHeaders() });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; content?: unknown };
    if (!body.ok) return null;
    return sanitize(body.content);
  } catch {
    return null;
  }
}

/** Push section(s) of the overlay to the wrapper. `null` clears a section.
 *  Resolves false when the server didn't take the write (other browsers won't
 *  see the edit) - callers surface that, never swallow it. */
async function pushRemoteCms(patch: Partial<Record<keyof CmsData, unknown>>): Promise<boolean> {
  try {
    const res = await fetch(apiUrl(CONTENT_URL), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return false;
    return !!((await res.json()) as { ok?: boolean }).ok;
  } catch {
    return false;
  }
}

/** Fetch the live catalog + config from Counterpoint AND the shared admin
 *  overlay from the wrapper. Safe to call repeatedly. */
export async function loadCatalog(): Promise<void> {
  const [config, categories, products, remote] = await Promise.all([
    fetchConfig(),
    fetchCategories(),
    fetchProducts(),
    fetchRemoteCms(),
  ]);
  live = { config, categories, products };
  // The server overlay is the source of truth for every browser: replace the
  // local cache with it (an empty overlay legitimately clears stale local
  // overrides). Only an unreachable wrapper leaves the cache untouched.
  if (remote !== null) write(remote);
}

/** Store-wide config (name, currency, tax, locations) from Counterpoint. */
export const getConfig = (): StoreConfig => live.config;

function read(): CmsData {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as CmsData;
  } catch {
    return {};
  }
}

function write(d: CmsData): void {
  localStorage.setItem(KEY, JSON.stringify(d));
}

// ── Reads (used by the storefront) ───────────────────────────────
// Admin override (server overlay, cached locally) wins; otherwise the live
// Counterpoint data.
export const getCategories = (): Category[] => read().categories ?? live.categories;
export const getProducts = (): Product[] => read().products ?? live.products;
export const getStores = (): StoreInfo[] =>
  read().stores ?? (live.config.stores.length ? live.config.stores : defaultStores);
/** Locations the storefront should show (customers). Excludes any the admin has
 *  marked hidden. The admin tool itself uses getStores() to see all of them. */
export const getVisibleStores = (): StoreInfo[] => getStores().filter((s) => !s.hidden);
export const getSlides = (): Slide[] => {
  const s = read().slides;
  return s && s.length ? s : defaultSlides;
};

// ── Writes (used by the admin tool) ──────────────────────────────
// Each save lands in the local cache immediately (instant UI) and pushes to
// the wrapper so every other browser picks it up on its next load. The
// returned promise reports whether the SERVER took the write.
export const saveCategories = (v: Category[]): Promise<boolean> => {
  write({ ...read(), categories: v });
  return pushRemoteCms({ categories: v });
};
export const saveProducts = (v: Product[]): Promise<boolean> => {
  write({ ...read(), products: v });
  return pushRemoteCms({ products: v });
};
export const saveStores = (v: StoreInfo[]): Promise<boolean> => {
  write({ ...read(), stores: v });
  return pushRemoteCms({ stores: v });
};
export const saveSlides = (v: Slide[]): Promise<boolean> => {
  write({ ...read(), slides: v });
  return pushRemoteCms({ slides: v });
};

/** Full snapshot (resolved overrides + live data) for backup / migration. */
export function exportData(): string {
  return JSON.stringify(
    {
      categories: getCategories(),
      products: getProducts(),
      stores: getStores(),
      slides: getSlides(),
    },
    null,
    2,
  );
}

/** Restore a backup: replaces the whole overlay locally AND on the server
 *  (missing sections are cleared). Await before reloading. */
export function importData(json: string): Promise<boolean> {
  const d = JSON.parse(json) as CmsData;
  write({ categories: d.categories, products: d.products, stores: d.stores, slides: d.slides });
  return pushRemoteCms({
    categories: d.categories ?? null,
    products: d.products ?? null,
    stores: d.stores ?? null,
    slides: d.slides ?? null,
  });
}

/** Forget all admin overrides (locally and on the server) so every browser
 *  falls back to the live Counterpoint catalog. Await before reloading. */
export async function resetAll(): Promise<boolean> {
  localStorage.removeItem(KEY);
  try {
    const res = await fetch(apiUrl(CONTENT_URL), { method: "DELETE", headers: authHeaders() });
    if (!res.ok) return false;
    return !!((await res.json()) as { ok?: boolean }).ok;
  } catch {
    return false;
  }
}

export function hasOverrides(): boolean {
  return Object.keys(read()).length > 0;
}
