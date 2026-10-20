"use client";

import type { ReactNode } from "react";

export function PortfolioEditLink({ id, children }: { id: string; children: ReactNode }) {
  return <a href={"#" + id} onClick={() => {
    const details = document.getElementById(id)?.querySelector("details");
    if (details instanceof HTMLDetailsElement) {
      details.open = true;
      details.querySelector("summary")?.focus({ preventScroll: true });
    }
  }}>{children}</a>;
}
