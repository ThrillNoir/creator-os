"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const pathname = usePathname();
  const messagesError = pathname.startsWith("/messages");
  const profileError = pathname.startsWith("/public-profile") || pathname.startsWith("/adult-profile");
  const localDetail = process.env.NODE_ENV === "development" ? error.message : null;
  const returnHref = messagesError ? "/messages" : profileError ? pathname.startsWith("/adult-profile") ? "/adult-profile" : "/public-profile" : "/library";
  const returnLabel = messagesError ? "Back to Messages" : profileError ? "Back to profile editor" : "Back to library";
  return <main className="friendly-error"><span className="brand-mark">T</span><p className="eyebrow">THOT OS</p><h1>That action didn&apos;t complete</h1><p>Your previous data is safe. Refresh this section before trying the action again.</p>{localDetail && <p role="alert">Local detail: {localDetail}</p>}<div><button className="primary" type="button" onClick={reset}>Refresh section</button><Link href={returnHref}>{returnLabel}</Link></div></main>;
}
