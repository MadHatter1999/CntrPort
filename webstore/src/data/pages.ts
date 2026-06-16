import type { ContentPage } from "./types";

/**
 * Static info pages (About, Delivery, Returns). Generic placeholder copy - edit
 * to match your store. The titles reuse the nav.* i18n keys.
 */
export const pages: ContentPage[] = [
  {
    id: "about",
    titleKey: "nav.about",
    body: [
      { t: "p", text: "Welcome to our online store. Browse our full catalog and order online for pickup or delivery." },
      { t: "p", text: "Our catalog, pricing and availability are kept up to date automatically, so what you see online matches what's in the store." },
      { t: "p", text: "Questions about a product or your order? Get in touch - we're happy to help." },
    ],
  },
  {
    id: "delivery",
    titleKey: "nav.delivery",
    body: [
      { t: "h", text: "Pickup" },
      { t: "p", text: "Order online and pick it up at the store. We'll let you know when it's ready." },
      { t: "h", text: "Delivery" },
      { t: "p", text: "Prefer it delivered? Choose delivery at checkout and enter your address." },
      { t: "h", text: "Payment" },
      { t: "p", text: "Pay securely at checkout. Card details are never stored." },
    ],
  },
  {
    id: "returns",
    titleKey: "nav.returns",
    body: [
      { t: "p", text: "If you're not satisfied with your purchase, contact us and we'll do our best to make it right." },
      { t: "p", text: "Return windows and eligibility vary by product. Please keep your receipt." },
      { t: "p", text: "For any questions about returns, please reach out to the store." },
    ],
  },
];
