import type { Category, Product } from "./types";
import type { StoreInfo } from "./stores";

/**
 * Storefront API client. Talks to the CntrPort wrapper's /api/store/* endpoints,
 * which read the catalog/categories/locations live from Counterpoint and accept
 * order writeback. Everything degrades to a safe empty value so the storefront
 * still renders if the API (or Counterpoint behind it) is unreachable.
 *
 * Configure the wrapper origin with VITE_STORE_API_BASE (e.g.
 * "http://localhost:5000"). Leave blank to call the same origin that serves the
 * app. If the wrapper enforces its API key, set VITE_STORE_API_KEY.
 */
const env = import.meta.env as unknown as Record<string, string | undefined>;
const BASE = (env.VITE_STORE_API_BASE ?? "").replace(/\/+$/, "");
const API_KEY = env.VITE_STORE_API_KEY ?? "";
const API_KEY_HEADER = env.VITE_STORE_API_KEY_HEADER ?? "X-API-Key";

export interface StoreConfig {
  name: string;
  currency: string;
  taxRate: number;
  stores: StoreInfo[];
}

const DEFAULT_CONFIG: StoreConfig = { name: "Web Store", currency: "USD", taxRate: 0, stores: [] };

function authHeaders(): Record<string, string> {
  return API_KEY ? { [API_KEY_HEADER]: API_KEY } : {};
}

/** Absolute URL for an API-relative path (e.g. an item image), honouring BASE. */
export function apiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${BASE}${path}`;
}

async function getJSON<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(apiUrl(path), { headers: authHeaders() });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

/** Rewrite a relative image path to an absolute one so cross-origin works. */
function absImage<T extends { image?: string }>(row: T): T {
  if (row.image && row.image.startsWith("/")) row.image = apiUrl(row.image);
  return row;
}

export const fetchConfig = (): Promise<StoreConfig> =>
  getJSON<StoreConfig>("/api/store/config", DEFAULT_CONFIG);

export const fetchCategories = async (): Promise<Category[]> =>
  (await getJSON<Category[]>("/api/store/categories", [])).map(absImage);

export const fetchProducts = async (): Promise<Product[]> =>
  (await getJSON<Product[]>("/api/store/products", [])).map(absImage);

export interface OrderResult {
  ok: boolean;
  ref?: string;
  doc_id?: string;
  counterpoint_status?: number;
  counterpoint_error?: string | null;
}

/** POST a placed order to Counterpoint (creates a Document). Never throws. */
export async function postOrder(payload: unknown): Promise<OrderResult> {
  try {
    const res = await fetch(apiUrl("/api/store/order"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as OrderResult;
  } catch {
    return { ok: false };
  }
}
