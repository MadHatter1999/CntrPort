# Web store (Counterpoint-backed PWA)

An installable shopping PWA that turns **whatever is in Counterpoint** into a web
store. It has no hard-coded catalog, store name, or locations: products,
categories, pricing, the store name and the store locations are all read live
from Counterpoint through the [CntrPort](../README.md) wrapper's `/api/store/*`
endpoints. Orders placed at checkout are written back to Counterpoint as a
Document **and** logged in the built-in admin screen as the source of truth.

> This started as a grocery mockup. All client-specific features (cross-border
> Meest parcel shipping) and data (store name, locations, scraped catalog, the
> multilingual catalog) have been removed - it's now a generic storefront.

## Stack

- **TypeScript** (strict) - no UI framework
- **Vite** - dev server + static production build
- **vite-plugin-pwa** (Workbox) - manifest, service worker, offline caching
- **Firebase** (optional) - admin login + cross-device order sync

## How it talks to Counterpoint

```
Shopper (PWA)  ──►  CntrPort wrapper  ──►  Counterpoint (SQL + API)
   src/data/api.ts        store_api.py
```

The whole data layer funnels through [`src/data/cms.ts`](src/data/cms.ts), which
calls [`src/data/api.ts`](src/data/api.ts):

| Storefront need        | Endpoint (on the wrapper)        | Counterpoint source            |
| ---------------------- | -------------------------------- | ------------------------------ |
| Store name / currency / tax / locations | `GET /api/store/config`          | `/Company`, inventory locations + env |
| Categories             | `GET /api/store/categories`      | `IM_CATEG` / `IM_ITEM`         |
| Products               | `GET /api/store/products`        | `IM_ITEM`                      |
| Item photos            | `GET /api/store/item-image/<id>` | `/Item/{ItemNo}/Images`        |
| Place an order         | `POST /api/store/order`          | `POST /Document`               |

Everything degrades gracefully: if the wrapper (or Counterpoint behind it) is
unreachable, the storefront renders an empty-but-working store rather than
breaking.

## Run it

The storefront needs the CntrPort wrapper running (see the [root
README](../README.md)). Then, from this folder:

```bash
npm install
npm run icons     # one-time: generate PWA PNG icons from the SVG
cp .env.example .env   # set VITE_STORE_API_BASE to your wrapper's URL
npm run dev       # http://localhost:5180
```

Production build + local preview:

```bash
npm run build     # type-checks, then builds to dist/
npm run preview   # serves the built PWA on http://localhost:4180
```

### Configuration (`.env`)

- `VITE_STORE_API_BASE` - origin of the CntrPort wrapper (e.g.
  `http://localhost:5000`). Blank = same origin as the app.
- `VITE_STORE_API_KEY` / `_HEADER` - only if the wrapper enforces its API key.
  (Note: a key here ships in the public bundle - prefer leaving the read
  endpoints open and gating writes at the network layer.)
- `VITE_FIREBASE_*` - optional, for the admin login + order sync.

Store **name, currency, tax rate and the order-writeback location/customer** are
configured on the **wrapper** side (`.env` in the repo root: `STORE_NAME`,
`STORE_CURRENCY`, `STORE_TAX_RATE`, `STORE_DEFAULT_LOC_ID`,
`STORE_DEFAULT_CUST_NO`), so the storefront stays presentation-only.

## Admin (internal, unlinked)

A dashboard at **`/admin`** (dev: `/admin.html`), unlinked from the public site:

- **Dashboard / Orders** - every web checkout is logged here (the source of
  truth), with status tracking and a sales overview. When Firebase is
  configured, orders sync across devices.
- **Items / Categories / Locations / Carousel** - presentation overrides stored
  in `localStorage`. With no overrides, everything comes straight from
  Counterpoint; an override lets you tweak things Counterpoint doesn't model
  (carousel slides, category tile images). **Reset** drops overrides and falls
  back to the live Counterpoint catalog.

**Local/demo mode (zero setup):** with no Firebase config the admin shows a
clearly-labelled demo login (any credentials work) and data lives in
`localStorage`. Add Firebase to require real staff accounts and share orders.

**PCI posture.** The checkout is a **mock** and never stores or transmits the
card number or CVC - only a derived brand + last 4 digits. For real payments,
hand card capture to a PCI-compliant processor (e.g. Stripe hosted fields).

## Project layout

```
src/
  data/        api client (api.ts), data access (cms.ts), orders, pages, slides, types
  i18n/        English message catalog
  state/       tiny reactive store (cart, filters) - persists to localStorage
  components/  shell (static HTML) + render (dynamic regions) + checkout
  admin/       internal admin dashboard + auth gate
  lib/         formatting + DOM helpers + Firebase wiring
  styles/      one CSS file with design tokens + responsive rules
scripts/       PWA icon generator (sharp)
```
