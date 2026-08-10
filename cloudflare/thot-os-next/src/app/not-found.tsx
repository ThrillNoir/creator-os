import Link from "next/link";

export default function NotFoundPage() {
  return <main className="friendly-error"><span className="brand-mark">T</span><p className="eyebrow">THOT OS</p><h1>We couldn&apos;t find that</h1><p>The asset or page may have moved. Return to the Content Library to keep working.</p><div><Link className="primary" href="/library">Back to library</Link></div></main>;
}
