import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Counterpoint-backed storefront PWA. Reads its catalog live from the CntrPort
// wrapper's /api/store/* endpoints; static build served by any host.

// Where the CntrPort wrapper is running. The dev/preview servers proxy /api to
// it so the browser sees the API as same-origin (no CORS). Change this if the
// wrapper runs on a different host/port. In production, leave VITE_STORE_API_BASE
// blank and serve the built dist/ behind the same origin as the wrapper, or set
// VITE_STORE_API_BASE to the wrapper's URL and enable CORS on the wrapper.
const WRAPPER_URL = "http://localhost:5000";
const apiProxy = {
  "/api": { target: WRAPPER_URL, changeOrigin: true, secure: false },
};

export default defineConfig({
  // Frontend dev/preview ports for this machine (kept off the default 5173 to
  // avoid clashing with other local projects).
  server: { port: 5180, proxy: apiProxy },
  preview: { port: 4180, proxy: apiProxy },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Web Store",
        short_name: "Store",
        description:
          "Shop our store online - live catalog, pricing and availability, with pickup or delivery.",
        lang: "en",
        dir: "ltr",
        theme_color: "#C1272D",
        background_color: "#FAF7F2",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        categories: ["food", "shopping"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        // The internal admin is part of this PWA- expose it as an app shortcut
        // (long-press the installed icon) while keeping it unlinked from the UI.
        shortcuts: [
          {
            name: "Admin dashboard",
            short_name: "Admin",
            description: "Manage items, categories, locations and carousel",
            url: "/admin",
            icons: [{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" }],
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // Product/hero photos are runtime-cached on first view, not precached.
        // The Firebase SDK chunks (index.esm-*) are only pulled in when a project
        // is configured, so keep them out of the precache to stay tiny.
        globIgnores: ["**/images/**", "**/index.esm-*.js"],
        navigateFallback: "/index.html",
        // The admin tool is its own page- don't fall back to the storefront.
        navigateFallbackDenylist: [/^\/admin/],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "image",
            handler: "CacheFirst",
            options: {
              cacheName: "enm-images",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      // Run the service worker in `npm run dev` too, so it behaves as a real
      // installable PWA during local development (on localhost / HTTPS).
      devOptions: { enabled: true, type: "module" },
    }),
  ],
  build: {
    target: "es2020",
    cssTarget: "chrome90",
    // Multi-page: the public storefront + the unlinked internal admin tool.
    rollupOptions: {
      input: {
        main: "index.html",
        admin: "admin.html",
      },
    },
  },
});
