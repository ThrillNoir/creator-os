"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function MessageHistory({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [away, setAway] = useState(false);
  const latest = () => {
    const element = viewport.current;
    if (element) element.scrollTop = element.scrollHeight;
    following.current = true;
    setAway(false);
  };
  useEffect(() => {
    latest();
    const observer = new ResizeObserver(() => {
      if (following.current && !window.getSelection()?.toString()) latest();
    });
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  return <div className="message-history">
    <div ref={viewport} className="message-history-viewport" role="region" aria-label="Conversation messages" tabIndex={0} onScroll={() => {
      const element = viewport.current;
      if (!element) return;
      following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
      setAway(!following.current);
    }}><div ref={content}>{children}</div></div>
    {away && <button className="compact-action message-jump-latest" type="button" onClick={latest}>Latest messages ↓</button>}
  </div>;
}
