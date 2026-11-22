import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Homemade by Bekah",
  description: "Your recipes, baking plans, and kitchen sessions.",
  applicationName: "Homemade by Bekah",
  robots: { index: false, follow: false },
  icons: { icon: "/brand/hb-favicon.svg", apple: "/icon-180.png" },
  appleWebApp: { capable: true, title: "Bekah Baking", statusBarStyle: "default" },
};
export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#FAF6EC" }, { media: "(prefers-color-scheme: dark)", color: "#1C1B17" }],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className="hb">{children}</body></html>;
}
