"use client";

import { useRef } from "react";
import type { Blocker } from "@/lib/portfolio-blockers";

export function BlockersDrawer({ title = "What needs attention", blockers, note, previousFailure, onNavigate }: {
  title?: string; blockers: Blocker[]; note?: string; previousFailure?: Blocker | null; onNavigate?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  function go(href: string) {
    dialog.current?.close();
    if (!href.startsWith("#")) return;
    onNavigate?.();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target = document.getElementById(decodeURIComponent(href.slice(1)));
        (target?.closest("details") ?? target?.querySelector("details"))?.setAttribute("open", "");
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
      });
    });
  }
  return <>
    <button type="button" className="secondary-action blockers-trigger" onClick={() => dialog.current?.showModal()}>
      Show blockers <span aria-hidden="true">({blockers.length})</span>
    </button>
    <dialog ref={dialog} className="blockers-drawer" aria-label={title} onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}>
      <div className="blockers-drawer-body">
        <div className="blockers-drawer-heading"><div><span className="eyebrow">RELEASE CHECKLIST</span><h2>{title}</h2></div><button type="button" onClick={() => dialog.current?.close()} aria-label="Close blockers">Close ×</button></div>
        {blockers.length ? <ol>{blockers.map((blocker, index) => <li key={`${blocker.href}-${blocker.message}-${index}`}><span>{index + 1}</span><a href={blocker.href} onClick={() => go(blocker.href)}>{blocker.message} →</a></li>)}</ol>
          : <p>No known blockers. Final media length, checksum and availability are checked during publication.</p>}
        {previousFailure && <p className="blockers-drawer-note">Last publication attempt: <a href={previousFailure.href} onClick={() => go(previousFailure.href)}>{previousFailure.message} →</a></p>}
        {note && <p className="blockers-drawer-note">{note}</p>}
      </div>
    </dialog>
  </>;
}
