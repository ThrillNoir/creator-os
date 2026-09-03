"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function MessageAutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, router]);
  return null;
}
