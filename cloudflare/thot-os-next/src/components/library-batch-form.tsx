"use client";

import { useEffect, useRef, useState, type ReactNode, type FormEvent, type MouseEvent } from "react";
import { useFormStatus } from "react-dom";

function selectedCount(form: HTMLFormElement) {
  return new Set(new FormData(form).getAll("assetId").map(String).map((value) => value.trim()).filter(Boolean)).size;
}

export function LibraryBatchForm({ action, children, initialSelectedCount = 0, selectionVersion }: { action: (data: FormData) => Promise<void>; children: ReactNode; initialSelectedCount?: number; selectionVersion?: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [count, setCount] = useState(initialSelectedCount);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (form.current) setCount(selectedCount(form.current)); }, [selectionVersion]);
  function submit(event: FormEvent<HTMLFormElement>) {
    const selected = selectedCount(event.currentTarget);
    if (!selected || selected > 50) {
      event.preventDefault();
      setError(!selected ? "Select at least one asset below before applying attributes." : "Select no more than 50 assets. Your selection and attributes are still here.");
    }
  }
  function selectCard(event: MouseEvent<HTMLFormElement>) {
    const target = event.target;
    if (event.detail === 0 || !(target instanceof Element) || !event.currentTarget.querySelector(".batch-panel[open]")) return;
    const card = target.closest(".asset-card");
    if (!card || target.closest("label, input, button, summary, details, video")) return;
    const link = target.closest("a");
    if (link && link !== card.querySelector("a")) return;
    const checkbox = card.querySelector<HTMLInputElement>('input[type="checkbox"][name="assetId"]');
    if (!checkbox) return;
    event.preventDefault();
    checkbox.click();
  }
  return <form ref={form} className="batch-form" action={action} onSubmit={submit} onClickCapture={selectCard} onChange={(event) => { setCount(selectedCount(event.currentTarget)); setError(null); }}>
    <p role="status">{count} selected · maximum 50 per batch</p>
    {error && <p role="alert">{error}</p>}
    {children}
  </form>;
}

export function LibraryBatchSubmit() {
  const { pending } = useFormStatus();
  return <button className="primary" type="submit" disabled={pending}>{pending ? "Saving selected assets…" : "Apply to selected assets"}</button>;
}
