import type { Metadata, Viewport } from "next";
import { Doto, Playfair_Display, VT323 } from "next/font/google";
import "./globals.css";

const vt323 = VT323({ weight: "400", subsets: ["latin"], variable: "--font-vt323" });
const doto = Doto({ weight: ["700", "800"], subsets: ["latin"], variable: "--font-doto" });
const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-playfair" });

export const metadata: Metadata = {
  // Link previews (opengraph-image.tsx) need absolute URLs.
  metadataBase: new URL("https://friendflower.app"),
  title: "friend flower",
  description: "Keep track of where in the world your friends are, and meet friends of friends wherever you are.",
  applicationName: "Friend Flower",
  appleWebApp: { capable: true, title: "Friend Flower", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0d0c0b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${vt323.variable} ${doto.variable} ${playfair.variable} antialiased`}>
      <body>
        {/* The app is designed as a phone screen; on a desktop it sits in a centred column. */}
        <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col bg-bg pt-[env(safe-area-inset-top)] sm:border-x sm:border-line-soft">
          {children}
        </div>
      </body>
    </html>
  );
}
