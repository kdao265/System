import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorkerRegistration } from "@/features/pwa/service-worker-registration";
import "./globals.css";

export const metadata: Metadata = {
  title: "SYSTEM V1",
  description: "A personal Life OS for purposeful action, growth, and recovery.",
  applicationName: "SYSTEM",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "SYSTEM", statusBarStyle: "black-translucent" },
  // Safari honours the modern `mobile-web-app-capable` name, which Next.js emits for
  // `appleWebApp`; the legacy Apple name is added for older iOS home-screen installs.
  other: { "apple-mobile-web-app-capable": "yes" },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
    ],
    apple: [{ url: "/icons/apple-touch-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

// `viewportFit: "cover"` is what makes env(safe-area-inset-*) resolve to real values
// when the installed app renders edge to edge; page containers add those insets on top
// of their existing padding. Zoom stays enabled.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#09090b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
