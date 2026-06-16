import type { Slide } from "./types";

/**
 * Default carousel slides. These reference i18n keys so they stay translated.
 * Admin-created slides use literal text + optional background images and, when
 * present in the CMS, replace this default set.
 */
export const defaultSlides: Slide[] = [
  { id: "s1", titleKey: "hero.1.title", subKey: "hero.1.sub", ctaKey: "hero.1.cta" },
  { id: "s2", titleKey: "hero.2.title", subKey: "hero.2.sub", ctaKey: "hero.2.cta" },
  { id: "s3", titleKey: "hero.3.title", subKey: "hero.3.sub", ctaKey: "hero.3.cta" },
];
