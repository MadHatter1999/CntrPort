import type { Category, Product, Slide, LangCode } from "../data/types";
import type { StoreInfo } from "../data/stores";
import { translate } from "../i18n";

/** Category label: literal name (from Counterpoint) → i18n key → id. */
export function catLabel(c: Category, _lang?: LangCode): string {
  return c.name ?? (c.nameKey ? translate("en", c.nameKey) : c.id);
}

/** Product name (from Counterpoint). */
export function prodName(p: Product, _lang?: LangCode): string {
  return p.name;
}

/** Store name. */
export function storeLabel(s: StoreInfo, _lang?: LangCode): string {
  return s.name;
}

/** Unit label (e.g. "100 g", "ea") - passed through as-is. */
export function unitLabel(unit: string, _lang?: LangCode): string {
  return unit;
}

/** Slide text: literal (admin override) → i18n key (seed slides) → "". */
export function slideField(s: Slide, field: "title" | "sub" | "cta", _lang?: LangCode): string {
  const lit = s[field];
  if (lit) return lit;
  const key = s[`${field}Key` as const];
  return key ? translate("en", key) : "";
}
