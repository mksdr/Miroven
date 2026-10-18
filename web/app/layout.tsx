import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { appOrigin } from "./lib/site-config";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const metadataBase = new URL(appOrigin);
  const imageUrl = `${appOrigin}/og.png`;

  return {
    metadataBase,
    alternates: {
      canonical: "/",
    },
    title: {
      default: "Miroven",
      template: "%s · Miroven",
    },
    description: "나만 볼 수 있는 암호화 저널 · A private, encrypted journal for your eyes only.",
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
        { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/icon.svg", type: "image/svg+xml" },
      ],
      shortcut: [
        { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
      ],
      apple: [
        { url: "/apple-touch-icon.svg", type: "image/svg+xml" },
      ],
    },
    applicationName: "Miroven",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "Miroven",
    },
    openGraph: {
      title: "Miroven",
      description: "A familiar timeline made private — your encrypted journal for every day.",
      type: "website",
      images: [{ url: imageUrl, width: 1536, height: 1024, alt: "Miroven private journal" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Miroven",
      description: "A familiar timeline made private — your encrypted journal for every day.",
      images: [imageUrl],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <Script
          id="appearance-script"
          strategy="beforeInteractive"
          src="/theme-init.js"
        />
        {children}
      </body>
    </html>
  );
}
