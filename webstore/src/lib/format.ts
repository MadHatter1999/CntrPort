import type { LangCode } from "../data/types";

// Currency is configured at runtime from the store config (Counterpoint).
let currency = "USD";

/** Set the active currency (call once at startup from the store config). */
export function setCurrency(code: string): void {
  if (code) currency = code;
}

/** Format a money amount in the store's currency (e.g. "$2.99"). The optional
 *  lang arg is accepted for call-site compatibility; the app is English-only. */
export function money(amount: number, _lang?: LangCode): string {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(amount);
}
