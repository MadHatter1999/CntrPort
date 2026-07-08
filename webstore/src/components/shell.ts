import { icon } from "../lib/icons";

/** Generic store mark. The store name is filled in at runtime from the
 *  Counterpoint store config (see render.renderBrand). The icon's black parts
 *  are recoloured to white on dark surfaces via CSS (see .brand__badge). */
const brandBadge = /* html */ `<img class="brand__badge" src="/favicon.svg" alt="" width="48" height="48" />`;

/**
 * The app shell. Dynamic regions (hero, categories, products, stores, locations,
 * footer) are empty containers filled from the live catalog by render.ts. The
 * store name (data-brand-name) is set from the Counterpoint store config.
 * Translatable chrome carries data-i18n.
 */
export function shellHTML(): string {
  return /* html */ `
  <a class="skip-link" href="#products" data-i18n="nav.catalog"></a>

  <header class="hdr" id="top">
    <div class="hdr__inner">
      <button class="icon-btn hdr__menu" data-action="toggle-menu" data-i18n-aria="a11y.menu">
        ${icon("menu", 22)}
      </button>

      <a class="brand" href="#top" data-action="home">
        ${brandBadge}
        <span class="brand__text">
          <span class="brand__name" data-brand-name>Web Store</span>
          <span class="brand__tag" data-i18n="brand.tagline"></span>
        </span>
      </a>

      <div class="search">
        <span class="search__icon">${icon("search", 18)}</span>
        <input class="search__input" type="search" id="search" autocomplete="off"
               data-action="search" data-i18n-placeholder="search.placeholder"
               data-i18n-aria="search.aria" />
      </div>

      <div class="hdr__actions">
        <button class="icon-btn cart-btn" data-action="open-cart" data-i18n-aria="a11y.openCart">
          ${icon("bag", 22)}
          <span class="cart-btn__count" id="cart-count" hidden></span>
        </button>
      </div>
    </div>

    <nav class="subnav" aria-label="Secondary">
      <a href="#" data-action="open-page" data-page="about" data-i18n="nav.about"></a>
      <a href="#" data-action="open-page" data-page="delivery" data-i18n="nav.delivery"></a>
      <a href="#" data-action="open-page" data-page="returns" data-i18n="nav.returns"></a>
      <a href="#" data-action="open-locations" data-i18n="nav.contacts"></a>
    </nav>
  </header>

  <main>
    <!-- Hero / carousel (filled from CMS slides) -->
    <section class="hero" id="hero" aria-roledescription="carousel">
      <div class="hero__track" id="hero-track"></div>
      <div class="hero__dots" id="hero-dots" role="tablist"></div>
    </section>

    <!-- Categories -->
    <section class="section" id="categories">
      <div class="section__head">
        <h2 data-i18n="section.categories"></h2>
      </div>
      <div class="cat-grid" id="category-grid"></div>
    </section>

    <!-- Products -->
    <section class="section" id="products">
      <div class="chips" id="chips" role="tablist" aria-label="Categories"></div>
      <div class="section__head">
        <h2 id="products-title" data-i18n="section.all"></h2>
        <span class="section__count" id="results-count"></span>
      </div>
      <div class="product-grid" id="product-grid"></div>
      <nav class="pagination" id="pagination" aria-label="Pagination" hidden></nav>
    </section>

    <!-- Stores -->
    <section class="section section--alt" id="stores">
      <div class="section__head"><h2 data-i18n="store.title"></h2></div>
      <div class="store-grid" id="store-grid"></div>
    </section>

    <!-- Delivery -->
    <section class="section" id="delivery">
      <div class="delivery">
        <div class="delivery__icon">${icon("truck", 38)}</div>
        <div>
          <h2 data-i18n="delivery.title"></h2>
          <p data-i18n="delivery.body"></p>
        </div>
      </div>
    </section>
  </main>

  <footer class="footer">
    <div class="footer__inner">
      <div class="footer__brand">
        ${brandBadge}
        <div>
          <strong data-brand-name>Web Store</strong>
          <p data-i18n="footer.tagline"></p>
        </div>
      </div>
      <nav class="footer__col" aria-label="Footer">
        <h4 data-i18n="footer.quick"></h4>
        <a href="#categories" data-i18n="nav.catalog"></a>
        <a href="#" data-action="open-page" data-page="about" data-i18n="nav.about"></a>
        <a href="#" data-action="open-page" data-page="delivery" data-i18n="nav.delivery"></a>
        <a href="#" data-action="open-page" data-page="returns" data-i18n="nav.returns"></a>
      </nav>
      <div class="footer__col">
        <h4 data-i18n="footer.contact"></h4>
        <div id="footer-stores"></div>
      </div>
    </div>
    <div class="footer__legal">
      <span>© ${new Date().getFullYear()} <span data-brand-name>Web Store</span>. <span data-i18n="footer.rights"></span></span>
      <span class="footer__demo" data-i18n="footer.demo"></span>
    </div>
  </footer>

  <!-- Cart drawer -->
  <div class="scrim" id="scrim" hidden></div>
  <aside class="cart" id="cart" aria-hidden="true" aria-label="Shopping cart">
    <header class="cart__head">
      <h2 data-i18n="cart.title"></h2>
      <button class="icon-btn" data-action="close-cart" data-i18n-aria="a11y.closeCart">
        ${icon("close", 20)}
      </button>
    </header>
    <div class="cart__body" id="cart-body"></div>
    <footer class="cart__foot" id="cart-foot" hidden>
      <p class="cart__pickup" data-i18n="cart.pickup"></p>
      <div class="cart__subtotal">
        <span data-i18n="cart.subtotal"></span>
        <strong id="cart-subtotal"></strong>
      </div>
      <button class="btn btn--primary btn--block" data-action="open-checkout" data-i18n="cart.checkout"></button>
      <button class="btn btn--text" data-action="clear-cart" data-i18n="cart.clear"></button>
    </footer>
  </aside>

  <!-- Mobile slide-in menu -->
  <aside class="menu" id="menu" aria-hidden="true" aria-label="Menu">
    <header class="menu__head">
      <strong data-brand-name>Web Store</strong>
      <button class="icon-btn" data-action="toggle-menu">${icon("close", 20)}</button>
    </header>
    <nav class="menu__nav">
      <a href="#categories" data-action="menu-link" data-i18n="nav.catalog"></a>
      <button class="menu__btn" data-action="open-page" data-page="about" data-i18n="nav.about"></button>
      <button class="menu__btn" data-action="open-page" data-page="delivery" data-i18n="nav.delivery"></button>
      <button class="menu__btn" data-action="open-page" data-page="returns" data-i18n="nav.returns"></button>
      <button class="menu__btn" data-action="open-locations" data-i18n="nav.contacts"></button>
    </nav>
  </aside>

  <!-- Locations / map view (filled from CMS stores) -->
  <div class="locations" id="locations" role="dialog" aria-modal="true" aria-hidden="true"
       data-i18n-aria="locations.title">
    <header class="locations__head">
      <h2 data-i18n="locations.title"></h2>
      <button class="icon-btn" data-action="close-locations" data-i18n-aria="a11y.closeLocations">${icon("close", 20)}</button>
    </header>
    <div class="locations__body" id="locations-body"></div>
  </div>

  <!-- Checkout (full-screen overlay; mock payment) -->
  <div class="checkout" id="checkout" role="dialog" aria-modal="true" aria-hidden="true"
       data-i18n-aria="checkout.title">
    <header class="checkout__head">
      <button class="icon-btn" data-action="close-checkout" data-i18n-aria="a11y.closeCheckout">
        ${icon("back", 20)}
      </button>
      <h2 data-i18n="checkout.title"></h2>
      <span class="checkout__brand">${brandBadge}</span>
    </header>
    <div class="checkout__body" id="checkout-body"></div>
  </div>

  <!-- Info pages (About / Delivery / Returns) -->
  <div class="page" id="page" role="dialog" aria-modal="true" aria-hidden="true">
    <header class="page__head">
      <h2 id="page-title"></h2>
      <button class="icon-btn" data-action="close-page" aria-label="Close">${icon("close", 20)}</button>
    </header>
    <div class="page__body article" id="page-body"></div>
  </div>

  <!-- Bottom nav (mobile, app-like) -->
  <nav class="bottomnav" aria-label="Primary">
    <a href="#top" class="bottomnav__item" data-action="home">
      ${icon("home", 22)}<span data-i18n="nav.home"></span>
    </a>
    <a href="#categories" class="bottomnav__item">
      ${icon("grid", 22)}<span data-i18n="nav.catalog"></span>
    </a>
    <button class="bottomnav__item" data-action="open-locations">
      ${icon("pin", 22)}<span data-i18n="nav.stores"></span>
    </button>
    <button class="bottomnav__item" data-action="open-cart">
      <span class="bottomnav__cart">${icon("bag", 22)}<span class="bottomnav__count" id="bottom-count" hidden></span></span>
      <span data-i18n="nav.cart"></span>
    </button>
  </nav>

  <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
  `;
}
