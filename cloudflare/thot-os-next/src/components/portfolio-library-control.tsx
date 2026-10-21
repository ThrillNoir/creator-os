"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Category = { id: string; name: string };
type Video = { id: string; basename: string };

export function PortfolioLibraryControl({ assetId, selected, available, canEdit, action, portfolioHref = "/portfolio", blockedReason,
  categories = [], fullVideos = [], selectedCategoryName, selectedFullLengthName, savedSafety, embedded = false }: {
  assetId: string; selected: boolean; available: boolean; canEdit: boolean; savedSafety: "sfw" | "nsfw" | null;
  action: (form: FormData) => Promise<void>; portfolioHref?: string; blockedReason?: string;
  categories?: Category[]; fullVideos?: Video[]; selectedCategoryName?: string | null; selectedFullLengthName?: string | null;
  embedded?: boolean;
}) {
  const [categoryChoice, setCategoryChoice] = useState("");
  const [draftSafety, setDraftSafety] = useState(savedSafety);
  const [classificationDirty, setClassificationDirty] = useState(false);
  useEffect(() => { setDraftSafety(savedSafety); }, [savedSafety, assetId]);
  useEffect(() => {
    if (!embedded) return;
    const form = document.querySelector<HTMLFormElement>(".classification-panel > form");
    if (!form) return;
    const snapshot = () => JSON.stringify([...new FormData(form)].map(([name, value]) => [name, String(value)]));
    const saved = snapshot();
    const check = () => setClassificationDirty(snapshot() !== saved);
    form.addEventListener("input", check);
    form.addEventListener("change", check);
    return () => { form.removeEventListener("input", check); form.removeEventListener("change", check); };
  }, [assetId, embedded]);
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ assetId: string; safety: "sfw" | "nsfw" | "" }>).detail;
      if (detail?.assetId !== assetId) return;
      setDraftSafety(detail.safety || null);
    };
    window.addEventListener("thot-os:classification-safety-changed", changed);
    return () => window.removeEventListener("thot-os:classification-safety-changed", changed);
  }, [assetId, savedSafety]);
  const reviewDirty = classificationDirty || draftSafety !== savedSafety;
  return <section className={`${embedded ? "portfolio-library-step" : "panel"} portfolio-library-control`}><div><h3>{embedded ? "4 · Portfolio" : selected ? "In your Portfolio draft" : "Add to Portfolio"}</h3>
    <p>{reviewDirty ? "Save your Review & Tag changes above before changing the Portfolio draft." : selected ? "Saved privately. This item is not live on your More page." : available ? "Choose a category and optional private full video. This only saves a private draft." : blockedReason ?? "This item is not eligible as a Portfolio preview."}</p>
    {selected && <p><strong>Category:</strong> {selectedCategoryName ?? "Needs review"} · <strong>Full-length link:</strong> {selectedFullLengthName ?? "None (preview only)"}</p>}</div>
    {selected ? <div className="portfolio-library-saved-actions">{canEdit && <form action={action}><input type="hidden" name="assetId" value={assetId} /><input type="hidden" name="intent" value="remove" />
      <button className="secondary-action" type="submit" disabled={reviewDirty}>Remove from Portfolio draft</button></form>}
      <Link className="secondary-action" href={portfolioHref}>Open Portfolio layout →</Link></div> : null}
    {!selected && canEdit && available && !reviewDirty && <div className="portfolio-library-add-flow">
      <form action={action} className="portfolio-library-add-form" onSubmit={(event) => {
        const current = document.querySelector<HTMLInputElement>(".classification-panel input[name=safety]")?.value;
        if (current !== savedSafety || classificationDirty) { event.preventDefault(); setDraftSafety(current === "nsfw" || current === "sfw" ? current : null); }
      }}><input type="hidden" name="assetId" value={assetId} /><input type="hidden" name="intent" value="add" /><input type="hidden" name="confirmAdd" value="yes" />
        <label>Category<select name="categoryChoice" value={categoryChoice} onChange={(event) => setCategoryChoice(event.target.value)} required>
          <option value="">Choose a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}<option value="__new__">+ Create a new category</option></select></label>
        {categoryChoice === "__new__" && <label>New category name<input name="newCategoryName" maxLength={50} required placeholder="e.g. Clips" /></label>}
        <label>Private full-length video <span>(optional)</span><select name="fullLengthAssetId" defaultValue=""><option value="">None · preview only</option>
          {fullVideos.filter((video) => video.id !== assetId).map((video) => <option value={video.id} key={video.id}>{video.basename}</option>)}</select></label>
        <p>A linked full video stays private. Visitors can request it only after you separately approve a public preview.</p>
        <button className="primary" type="submit">Add to private Portfolio</button>
      </form>
    </div>}
  </section>;
}
