import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Neon Courier // Cyberpunk Web Delivery Game",
  description:
    "Deliver cargo across neo-metropolis districts, dodge interceptor drones, and upgrade your cyber hoverbike.",
  applicationName: "Neon Courier",
  // PWA presentation when launched from a home-screen install. The manifest
  // itself comes from `app/manifest.ts` (file-convention metadata links it).
  appleWebApp: {
    capable: true,
    title: "Neon Courier",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico" },
    ],
    apple: "/icons/icon-180.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Matches `background_color`/`theme_color` in the manifest, so the installed
  // window's title bar and the splash screen are the same cyberpunk black.
  themeColor: "#08090d",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-cyber-black text-slate-100 font-sans selection:bg-neon-pink selection:text-white">
        {/* Registers the service worker (production only) and mirrors
            `navigator.onLine` into the store for the HUD badge. */}
        <ServiceWorkerRegistration />
        {/* Auth state is client-side UI state: the navbar reflects it, but every
            protected *read* is still gated by RLS and every write by the database. */}
        <AuthProvider>
          <Navbar />
          <main className="flex-1 flex flex-col">{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}

