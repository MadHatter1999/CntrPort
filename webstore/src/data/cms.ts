import { defaultSlides } from "./slides";
import { defaultStores, type StoreInfo } from "./stores";
import type { Category, Product, Slide } from "./types";
import { fetchConfig, fetchCategories, fetchProducts, type StoreConfig } from "./api";

/**
 * Storefront data access. The catalog (categories, products) and store config
 * (name, currency, tax, locations) are read live from Counterpoint via the
 * CntrPort wrapper at startup - call loadCatalog() before the first render.
 *
 * The admin tool can still override any collection: edits are saved to this
 * browser's localStorage and take precedence over the live Counterpoint data
 * (useful for presentation-only fields Counterpoint doesn't model, e.g. carousel
 * slides or category tile images). With no overrides, everything comes from CP.
 */
const KEY = "store.cms.v1";

export interface CmsData {
  categories?: Category[];
  products?: Product[];
  stores?: StoreInfo[];
  slides?: Slide[];
}

const DEFAULT_CONFIG: StoreConfig = { name: "Web Store", currency: "USD", taxRate: 0, stores: [] };

// Live catalog pulled from Counterpoint. Empty until loadCatalog() resolves.
let live: { config: StoreConfig; categories: Category[]; products: Product[] } = {
  config: DEFAULT_CONFIG,
  categories: [],
  products: [],
};

/** Fetch the live catalog + config from Counterpoint. Safe to call repeatedly. */
export async function loadCatalog(): Promise<void> {
  const [config, categories, products] = await Promise.all([
    fetchConfig(),
    fetchCategories(),
    fetchProducts(),
  ]);
  live = { config, categories, products };
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
// Admin override (localStorage) wins; otherwise the live Counterpoint data.
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
export const saveCategories = (v: Category[]) => write({ ...read(), categories: v });
export const saveProducts = (v: Product[]) => write({ ...read(), products: v });
export const saveStores = (v: StoreInfo[]) => write({ ...read(), stores: v });
export const saveSlides = (v: Slide[]) => write({ ...read(), slides: v });

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

export function importData(json: string): void {
  const d = JSON.parse(json) as CmsData;
  write({ categories: d.categories, products: d.products, stores: d.stores, slides: d.slides });
}

/** Forget all admin overrides and fall back to the live Counterpoint catalog. */
export function resetAll(): void {
  localStorage.removeItem(KEY);
}

export function hasOverrides(): boolean {
  return Object.keys(read()).length > 0;
}
