"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function ErrorPage({ reset }: { reset: () => void }) {
  const pathname = usePathname();
  const messagesError = pathname.startsWith("/messages");
  return <main className="friendly-error"><span className="brand-mark">T</span><p className="eyebrow">THOT OS</p><h1>That action didn&apos;t complete</h1><p>Your previous data is safe. Refresh this section before trying the action again.</p><div><button className="primary" type="button" onClick={reset}>Refresh section</button><Link href={messagesError ? "/messages" : "/library"}>{messagesError ? "Back to Messages" : "Back to library"}</Link></div></main>;
}
