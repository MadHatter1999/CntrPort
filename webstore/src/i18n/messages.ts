import type { LangCode } from "../data/types";

export interface LangMeta {
  code: LangCode;
  /** Native language name. */
  native: string;
  /** Flag emoji for a compact visual cue. */
  flag: string;
}

/** The store ships in English. (The i18n plumbing is kept so copy lives in one
 *  place and a language could be re-added later.) */
export const languages: LangMeta[] = [{ code: "en", native: "English", flag: "🇬🇧" }];

type Dict = Record<string, string>;

const en: Dict = {
  "brand.tagline": "Shop online - pickup or delivery",

  "nav.home": "Home",
  "nav.catalog": "Catalog",
  "nav.about": "About",
  "nav.delivery": "Delivery & Payment",
  "nav.returns": "Return Policy",
  "nav.contacts": "Contact",
  "nav.stores": "Stores",
  "nav.cart": "Cart",

  "search.placeholder": "Search products…",
  "search.aria": "Search products",

  "hero.1.title": "Shop our store online",
  "hero.1.sub": "Browse the full catalog and order in minutes.",
  "hero.1.cta": "Shop the catalog",
  "hero.2.title": "Fresh stock, updated daily",
  "hero.2.sub": "Live pricing and availability straight from our store.",
  "hero.2.cta": "Browse products",
  "hero.3.title": "Pickup or delivery",
  "hero.3.sub": "Order online and choose how you get it.",
  "hero.3.cta": "Start shopping",

  "section.categories": "Shop by category",
  "section.popular": "Popular right now",
  "section.all": "All products",
  "chip.all": "All",

  "results.count": "{n} products",
  "results.none": "No products match your search.",
  "results.clear": "Clear search",

  "product.add": "Add",
  "badge.new": "New",
  "badge.popular": "Popular",
  "badge.sale": "Sale",
  "product.was": "was",

  "cart.title": "Your cart",
  "cart.empty": "Your cart is empty",
  "cart.emptySub": "Add some items to get started.",
  "cart.browse": "Start shopping",
  "cart.subtotal": "Subtotal",
  "cart.checkout": "Checkout",
  "cart.clear": "Clear",
  "cart.pickup": "Pick up in store or get it delivered at checkout.",
  "cart.qty": "Quantity",

  "checkout.title": "Checkout",
  "checkout.fulfil": "Delivery method",
  "checkout.pickup": "Store pickup",
  "checkout.pickupSub": "Free · ready soon",
  "checkout.shipping": "Delivery",
  "checkout.shippingSub": "Delivered to your address · flat {fee}",
  "checkout.pickStore": "Pickup location",
  "checkout.contact": "Contact details",
  "checkout.name": "Full name",
  "checkout.email": "Email",
  "checkout.phone": "Phone",
  "checkout.shipTo": "Delivery address",
  "checkout.address": "Street address",
  "checkout.city": "City / Province",
  "checkout.postal": "Postal code",
  "checkout.notes": "Order notes (optional)",
  "checkout.notesPh": "Buzzer code, allergies, gift message…",
  "checkout.payment": "Payment",
  "checkout.testMode": "Demo mode - enter any card, you won't be charged.",
  "checkout.cardName": "Name on card",
  "checkout.card": "Card number",
  "checkout.expiry": "Expiry",
  "checkout.cvc": "CVC",
  "checkout.summary": "Order summary",
  "checkout.subtotal": "Subtotal",
  "checkout.ship": "Delivery",
  "checkout.tax": "Tax",
  "checkout.free": "Free",
  "checkout.total": "Total",
  "checkout.place": "Place order · {total}",
  "checkout.placing": "Placing order…",
  "checkout.invalid": "Please complete the highlighted fields.",
  "checkout.emptyTitle": "Nothing to check out",
  "checkout.emptySub": "Add a few items to your cart first.",
  "checkout.confirmTitle": "Order confirmed!",
  "checkout.confirmThanks": "Thanks {name} - we've got it from here.",
  "checkout.ref": "Order number",
  "checkout.pickupInfo": "Ready for pickup at {store} - we'll be in touch when it's packed.",
  "checkout.shipInfo": "We'll deliver your order to {address}.",
  "checkout.emailed": "A receipt is on its way to {email}.",
  "checkout.continue": "Continue shopping",
  "a11y.closeCheckout": "Close checkout",

  "order.status.new": "Received",
  "order.status.preparing": "Preparing",
  "order.status.ready": "Ready",
  "order.status.completed": "Completed",
  "order.status.cancelled": "Cancelled",

  "store.title": "Visit us",
  "store.monSat": "Mon–Sat",
  "store.sun": "Sun",
  "store.directions": "Directions",
  "store.call": "Call",
  "store.viewMap": "View on map",
  "locations.title": "Our locations",
  "locations.apple": "Apple Maps",
  "locations.google": "Google Maps",
  "a11y.closeLocations": "Close locations",

  "delivery.title": "Delivery & payment",
  "delivery.body":
    "Order online for in-store pickup or delivery. Pay securely at checkout.",

  "footer.tagline": "Quality products and great service.",
  "footer.quick": "Quick links",
  "footer.contact": "Contact",
  "footer.rights": "All rights reserved.",
  "footer.demo": "Online store powered by Counterpoint.",

  "a11y.openCart": "Open cart",
  "a11y.closeCart": "Close cart",
  "a11y.menu": "Menu",

  "toast.added": "Added to cart",
  "toast.offline": "Ready to use offline",
  "toast.update": "New version available- tap to refresh",
};

export const messages: Record<string, Dict> = { en };
