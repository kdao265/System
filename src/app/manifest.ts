import type { MetadataRoute } from "next";

// Installable "Personal Beta" metadata. Colors match the dark SYSTEM surface in
// globals.css; the icons are committed under `public/icons` and reproduced by
// `node scripts/generate-pwa-icons.mjs`.
//
// `/dashboard` is the installed start URL: an authenticated request renders the
// dashboard and an unauthenticated one is redirected to `/login` by the existing
// server boundary, so the manifest never grants access on its own.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "SYSTEM",
    short_name: "SYSTEM",
    description: "A personal Life OS for purposeful action, growth, and recovery.",
    lang: "en",
    dir: "ltr",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
