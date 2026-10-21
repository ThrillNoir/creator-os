import { readFileSync, writeFileSync } from "node:fs";

// This substitution is confined to the disposable image. Next's Google Fonts
// loader otherwise makes remote requests while compiling local pages.
const file = "/app/cloudflare/thot-os-next/src/app/layout.tsx";
let source = readFileSync(file, "utf8");
const replacements = [
  ['import { Geist, Geist_Mono } from "next/font/google";\n', ""],
  ['const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });\nconst geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });\n', ""],
  ['className={`${geistSans.variable} ${geistMono.variable} dark`}', 'className="dark" style={{ "--font-geist-sans": "Arial, sans-serif", "--font-geist-mono": "monospace" } as React.CSSProperties}'],
];
for (const [before, after] of replacements) {
  if (!source.includes(before)) throw new Error("Fixture font substitution no longer matches source layout");
  source = source.replace(before, after);
}
writeFileSync(file, source);
