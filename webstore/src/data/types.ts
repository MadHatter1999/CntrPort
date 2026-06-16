/** Shared domain types for the catalog. */

export type LangCode = "en" | "uk" | "ru" | "pl" | "fr";

/** Per-language text overrides, e.g. { uk: "Ковбаса", ru: "Колбаса" }. */
export type Localized = Partial<Record<LangCode, string>>;

export interface Category {
  /** Stable slug, mirrors the live site's URLs (e.g. "deli-meats"). */
  id: string;
  /** Local path to a representative product photo for the tile. */
  image: string;
  /** i18n message key (seed categories). Admin categories use `name` instead. */
  nameKey?: string;
  /** Literal default name (admin-created categories). */
  name?: string;
  /** Per-language name overrides. */
  names?: Localized;
  /** Soft accent used behind the tile image. */
  tint: string;
}

export interface Product {
  id: string;
  /** Default (English) product name. */
  name: string;
  /** Per-language name overrides; falls back to `name`. */
  names?: Localized;
  categoryId: string;
  /** Price in CAD. */
  price: number;
  /** Sold-by unit label, e.g. "100 g", "454 g", "2 L", "ea". */
  unit: string;
  /** Product photo path or URL (or a data: URL from an admin upload). */
  image: string;
  /** Marketing flags drive the card badges. */
  badge?: "new" | "popular" | "sale";
  /** Optional struck-through original price when on sale. */
  wasPrice?: number;
}

/** A hero/carousel slide. Seed slides use i18n keys; admin slides use literals. */
export interface Slide {
  id: string;
  titleKey?: string;
  subKey?: string;
  ctaKey?: string;
  /** Literal text (admin-authored), used when the *Key fields are absent. */
  title?: string;
  sub?: string;
  cta?: string;
  /** Optional background image (URL or data: URL). */
  bg?: string;
}

/** A block of content within a static info page. */
export interface ContentBlock {
  /** "h" = sub-heading, "p" = paragraph, "li" = list item. */
  t: "h" | "p" | "li";
  text: string;
}

/** A static info page (About, Delivery, Returns). */
export interface ContentPage {
  id: string;
  /** i18n key for the page title (reuses the nav.* keys). */
  titleKey: string;
  body: ContentBlock[];
}
