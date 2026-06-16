import type { Localized } from "./types";

/** A store location. Populated live from Counterpoint inventory locations
 *  (see /api/store/config); the admin can also override via the CMS. */
export interface StoreInfo {
  id: string;
  /** Display name (literal); `names` can override per language. */
  name: string;
  names?: Localized;
  address: string;
  phone: string;
  monSat: string;
  sun: string;
}

/** No hard-coded locations - they come from Counterpoint at runtime. */
export const defaultStores: StoreInfo[] = [];

/** tel: href from a display phone number. */
export function telHref(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return "tel:+" + (d.length === 10 ? "1" + d : d);
}

/** Google-Maps embed + deep links from a postal address (no API key needed). */
export function mapLinks(address: string) {
  const q = encodeURIComponent(address);
  return {
    embed: `https://www.google.com/maps?q=${q}&output=embed`,
    apple: `https://maps.apple.com/?q=${q}`,
    google: `https://www.google.com/maps/search/?api=1&query=${q}`,
  };
}
