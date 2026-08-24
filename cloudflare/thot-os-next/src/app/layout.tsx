import type { Metadata } from "next";
import { requireAccessIdentity } from "@/lib/access";
import "./globals.css";

export const metadata: Metadata = { title: "THOT OS", description: "Private creator operations workspace" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireAccessIdentity();
  return <html lang="en" className="dark"><body>{children}</body></html>;
}
