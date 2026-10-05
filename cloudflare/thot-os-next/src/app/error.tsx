"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const pathname = usePathname();
  const messagesError = pathname.startsWith("/messages");
  const profileError = pathname.startsWith("/public-profile") || pathname.startsWith("/adult-profile");
  const localDetail = process.env.NODE_ENV === "development" ? error.message : null;
  const workspaceSection = ["/money", "/growth", "/operations", "/accounts", "/onboarding", "/access", "/creators"].find((route) => pathname === route || pathname.startsWith(`${route}/`));
  const returnHref = workspaceSection ?? (messagesError ? "/messages" : profileError ? pathname.startsWith("/adult-profile") ? "/adult-profile" : "/public-profile" : "/library");
  const returnLabel = workspaceSection ? "Back to this section" : messagesError ? "Back to Messages" : profileError ? "Back to profile editor" : "Back to library";
  return <main className="friendly-error"><span className="brand-mark">T</span><p className="eyebrow">THOT OS</p><h1>We couldn&apos;t confirm the result</h1><p>Refresh this section and check its current state before repeating the action.</p>{localDetail && <p role="alert">Local detail: {localDetail}</p>}<div><button className="primary" type="button" onClick={reset}>Refresh section</button><Link href={returnHref}>{returnLabel}</Link></div></main>;
}
