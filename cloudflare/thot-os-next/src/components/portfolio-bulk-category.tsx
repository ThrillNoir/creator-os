"use client";

import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

type Category = { id: string; name: string };

function ApplyButton({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return <button disabled={!ready || pending} type="submit">{pending ? "Applying…" : "Apply category"}</button>;
}

export function PortfolioBulkCategory({ action, categories, itemCount, children }: {
  action: (form: FormData) => Promise<void>;
  categories: Category[];
  itemCount: number;
  children: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [categoryId, setCategoryId] = useState("");
  function boxes() { return [...(formRef.current?.querySelectorAll<HTMLInputElement>('input[name="assetIds"]') ?? [])]; }
  function updateCount(event: ChangeEvent<HTMLFormElement>) {
    const inputs = boxes();
    const selected = inputs.filter((input) => input.checked);
    if (selected.length > 50 && event.target instanceof HTMLInputElement && event.target.name === "assetIds") event.target.checked = false;
    setSelectedCount(inputs.filter((input) => input.checked).length);
  }
  function selectVisible() {
    const inputs = boxes();
    for (const [index, input] of inputs.entries()) input.checked = index < 50;
    setSelectedCount(Math.min(inputs.length, 50));
  }
  function clearSelection() {
    for (const input of boxes()) input.checked = false;
    setSelectedCount(0);
  }
  return <form action={action} className="portfolio-bulk-form" onChange={updateCount} ref={formRef}>
    <div className="portfolio-bulk-toolbar"><div className="portfolio-bulk-selection"><strong aria-live="polite">{selectedCount} selected</strong><span>Up to 50 at once</span><button className="secondary-action" onClick={selectVisible} type="button">{itemCount > 50 ? "Select first 50" : "Select all"}</button>{selectedCount > 0 && <button className="secondary-action" onClick={clearSelection} type="button">Clear</button>}</div>
      <label>Set category<select name="categoryId" onChange={(event) => setCategoryId(event.target.value)} required value={categoryId}><option value="">Choose category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><ApplyButton ready={selectedCount > 0 && Boolean(categoryId)} />
    </div>
    {categories.length === 0 && <p className="portfolio-bulk-hint">Create a category below before assigning items.</p>}
    {children}
  </form>;
}
