import "./styles/main.css";
import { shellHTML } from "./components/shell";
import {
  applyI18n,
  renderBrand,
  renderHero,
  renderStores,
  renderLocations,
  renderChips,
  renderCategoryGrid,
  renderProducts,
  renderCart,
  renderPage,
  renderBadges,
  syncDocTitle,
  loadData,
} from "./components/render";
import {
  state,
  subscribe,
  setCategory,
  setQuery,
  addToCart,
  clearCart,
  setCartOpen,
  setMenuOpen,
  setLocationsOpen,
  setCheckoutOpen,
  setPage,
  setProductPage,
} from "./state/store";
import { openCheckout } from "./components/checkout";
import { loadCatalog, getConfig } from "./data/cms";
import { setCurrency } from "./lib/format";
import { t } from "./i18n";
import { $ } from "./lib/dom";

const app = $("#app");

let firstPaint = true;

function render(): void {
  // One-time, non-interactive regions (catalog is static within a session).
  if (firstPaint) {
    applyI18n();
    renderBrand();
    renderHero();
    initCarousel();
    renderCategoryGrid();
    renderStores();
    renderLocations();
    syncDocTitle();
    firstPaint = false;
  }

  renderChips();
  renderProducts();
  renderCart();
  renderPage();
  renderBadges();

  document.body.classList.toggle("is-cart-open", state.cartOpen);
  document.body.classList.toggle("is-menu-open", state.menuOpen);
  document.body.classList.toggle("is-locations-open", state.locationsOpen);
  document.body.classList.toggle("is-checkout-open", state.checkoutOpen);
  document.body.classList.toggle("is-page-open", !!state.page);
  $("#scrim").hidden = !(state.cartOpen || state.menuOpen || state.locationsOpen || state.page);
  $("#cart").setAttribute("aria-hidden", String(!state.cartOpen));
  $("#menu").setAttribute("aria-hidden", String(!state.menuOpen));
  $("#locations").setAttribute("aria-hidden", String(!state.locationsOpen));
  $("#checkout").setAttribute("aria-hidden", String(!state.checkoutOpen));
  $("#page").setAttribute("aria-hidden", String(!state.page));
}

/** Google-Maps embeds are heavy, so only load them the first time the view opens. */
function loadMaps(): void {
  document.querySelectorAll<HTMLIFrameElement>("iframe.locmap[data-src]").forEach((f) => {
    f.src = f.dataset.src!;
    f.removeAttribute("data-src");
  });
}

// ── Hero carousel ────────────────────────────────────────────────
let slide = 0;
let slideCount = 0;
let heroTimer: number | undefined;

function initCarousel(): void {
  slideCount = $("#hero-dots").querySelectorAll(".hero__dot").length;
  slide = 0;
  goToSlide(0);
}

function goToSlide(n: number): void {
  if (slideCount === 0) return;
  slide = (n + slideCount) % slideCount;
  $("#hero-track").style.transform = `translateX(-${slide * 100}%)`;
  $("#hero-dots")
    .querySelectorAll(".hero__dot")
    .forEach((d, idx) => d.classList.toggle("is-active", idx === slide));
  restartHero();
}

function restartHero(): void {
  window.clearInterval(heroTimer);
  if (slideCount > 1) heroTimer = window.setInterval(() => goToSlide(slide + 1), 5500);
}

// ── Helpers ──────────────────────────────────────────────────────
function scrollToId(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

let toastTimer: number | undefined;
function showToast(msg: string): void {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  el.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.classList.remove("is-visible");
    window.setTimeout(() => (el.hidden = true), 250);
  }, 1800);
}

// ── Event delegation (document-level; safe before the shell mounts) ──
document.addEventListener("click", (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!target) return;
  const { action, id, cat, i, page, pnum } = target.dataset;

  switch (action) {
    case "home":
      setCategory("all");
      scrollToId("top");
      break;
    case "open-cart":
      setCartOpen(true);
      break;
    case "close-cart":
      setCartOpen(false);
      break;
    case "toggle-menu":
      setMenuOpen(!state.menuOpen);
      break;
    case "menu-link":
      setMenuOpen(false);
      break;
    case "open-locations":
      e.preventDefault();
      loadMaps();
      setLocationsOpen(true);
      break;
    case "close-locations":
      setLocationsOpen(false);
      break;
    case "open-page":
      e.preventDefault();
      setPage(page!);
      $("#page-body").scrollTop = 0;
      break;
    case "close-page":
      setPage(null);
      break;
    case "chip":
      setCategory(cat!);
      scrollToId("products");
      break;
    case "goto-page":
      setProductPage(Number(pnum));
      scrollToId("products");
      break;
    case "add":
      addToCart(id!, +1);
      showToast(t("toast.added"));
      break;
    case "dec":
      addToCart(id!, -1);
      break;
    case "clear-cart":
      clearCart();
      break;
    case "clear-search": {
      setQuery("");
      ($("#search") as HTMLInputElement).value = "";
      break;
    }
    case "open-checkout":
      openCheckout();
      break;
    case "close-checkout":
      setCheckoutOpen(false);
      break;
    case "hero-cta":
      scrollToId("products");
      break;
    case "hero-dot":
      goToSlide(Number(i));
      break;
  }
});

// Escape closes overlays.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    setCartOpen(false);
    setMenuOpen(false);
    setLocationsOpen(false);
    setCheckoutOpen(false);
    setPage(null);
  }
});

/** Wire element-specific listeners that need the shell mounted. */
function wireMountedEvents(): void {
  // Close overlays when tapping the scrim.
  $("#scrim").addEventListener("click", () => {
    setCartOpen(false);
    setMenuOpen(false);
    setLocationsOpen(false);
    setPage(null);
  });

  // Search (debounced just enough to feel snappy without thrashing).
  let searchTimer: number | undefined;
  $("#search").addEventListener("input", (e) => {
    const value = (e.target as HTMLInputElement).value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => setQuery(value), 120);
  });

  // Crossing the desktop/mobile breakpoint flips pagination on/off, so re-render
  // the product grid when it changes.
  window.matchMedia("(min-width: 768px)").addEventListener("change", () => {
    renderProducts();
  });
}

// ── Boot: pull the live catalog from Counterpoint, then render ──────
async function boot(): Promise<void> {
  await loadCatalog();
  setCurrency(getConfig().currency);
  loadData();

  app.innerHTML = shellHTML();
  app.removeAttribute("aria-busy");
  document.documentElement.lang = state.lang;

  wireMountedEvents();
  subscribe(render);
  render();
}

void boot();

// ── PWA service worker ───────────────────────────────────────────
import("virtual:pwa-register")
  .then(({ registerSW }) => {
    const updateSW = registerSW({
      onNeedRefresh() {
        showToast(t("toast.update"));
        updateSW(true);
      },
      onOfflineReady() {
        showToast(t("toast.offline"));
      },
    });
  })
  .catch(() => {
    /* PWA disabled in dev- ignore. */
  });
