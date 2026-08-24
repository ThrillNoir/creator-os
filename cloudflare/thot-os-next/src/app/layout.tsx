import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { requireAccessIdentity } from "@/lib/access";
import "./globals.css";
import "./boldkit-cloud.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = { title: "THOT OS", description: "Private creator operations workspace" };
export const viewport: Viewport = { colorScheme: "dark light", themeColor: "#1d161a", width: "device-width", initialScale: 1 };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireAccessIdentity();
  return <html className={`${geistSans.variable} ${geistMono.variable} dark`} lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
