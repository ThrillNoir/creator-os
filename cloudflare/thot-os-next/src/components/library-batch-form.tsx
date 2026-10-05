"use client";

import { useState, type ReactNode, type FormEvent } from "react";
import { useFormStatus } from "react-dom";

function selectedCount(form: HTMLFormElement) {
  return new Set(new FormData(form).getAll("assetId").map(String).map((value) => value.trim()).filter(Boolean)).size;
}

export function LibraryBatchForm({ action, children }: { action: (data: FormData) => Promise<void>; children: ReactNode }) {
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    const selected = selectedCount(event.currentTarget);
    if (!selected || selected > 50) {
      event.preventDefault();
      setError(!selected ? "Select at least one asset below before applying attributes." : "Select no more than 50 assets. Your selection and attributes are still here.");
    }
  }
  return <form className="batch-form" action={action} onSubmit={submit} onChange={(event) => { setCount(selectedCount(event.currentTarget)); setError(null); }}>
    <p role="status">{count} selected · maximum 50 per batch</p>
    {error && <p role="alert">{error}</p>}
    {children}
  </form>;
}

export function LibraryBatchSubmit() {
  const { pending } = useFormStatus();
  return <button className="primary" type="submit" disabled={pending}>{pending ? "Saving selected assets…" : "Apply to selected assets"}</button>;
}
