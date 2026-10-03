import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import Toaster from "@/components/Toaster";
import { THEME_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "LandLocked Cards - Stream Ops",
  description: "Show sets, inventory, and streamer pay",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider appearance={{ variables: { colorPrimary: "#7AA2FF" } }}>
      {/* suppressHydrationWarning because the pre-paint script writes
          data-theme onto this element before React sees it, which is the
          whole point: the correct theme is painted on the first frame. */}
      <html lang="en" suppressHydrationWarning>
        <head>
          {/* First thing in the document, synchronous and inline. Anything
              deferred paints the default theme and then corrects it, which is
              the flash the blueprint rules out. */}
          <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link
            href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600;700&display=swap"
            rel="stylesheet"
          />
        </head>
        <body>{children}<Toaster /></body>
      </html>
    </ClerkProvider>
  );
}
