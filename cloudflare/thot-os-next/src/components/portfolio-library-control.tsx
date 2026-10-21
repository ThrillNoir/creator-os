"use client";

import Link from "next/link";
import { useState } from "react";

type Category = { id: string; name: string };
type Video = { id: string; basename: string };

export function PortfolioLibraryControl({ assetId, selected, available, canEdit, action, portfolioHref = "/portfolio", blockedReason,
  categories = [], fullVideos = [], selectedCategoryName, selectedFullLengthName, embedded = false }: {
  assetId: string; selected: boolean; available: boolean; canEdit: boolean;
  action: (form: FormData) => Promise<void>; portfolioHref?: string; blockedReason?: string;
  categories?: Category[]; fullVideos?: Video[]; selectedCategoryName?: string | null; selectedFullLengthName?: string | null;
  embedded?: boolean;
}) {
  const [categoryChoice, setCategoryChoice] = useState("");
  return <section className={`${embedded ? "portfolio-library-step" : "panel"} portfolio-library-control`}><div><h3>{embedded ? "4 · Portfolio" : selected ? "In your Portfolio draft" : "Add to Portfolio"}</h3>
    <p>{selected ? "Saved privately. This item is not live on your More page." : available ? "Choose a category and optional private full video. This only saves a private draft. Tags are for filtering." : blockedReason ?? "This item is not eligible as a Portfolio preview."}</p>
    {selected && <p><strong>Category:</strong> {selectedCategoryName ?? "Needs review"} · <strong>Full-length link:</strong> {selectedFullLengthName ?? "None (preview only)"}</p>}</div>
    {selected ? <div className="portfolio-library-saved-actions">{canEdit && <form action={action}><input type="hidden" name="assetId" value={assetId} /><input type="hidden" name="intent" value="remove" />
      <button className="secondary-action" type="submit">Remove from Portfolio draft</button></form>}
      <Link className="secondary-action" href={portfolioHref}>Open Portfolio layout →</Link></div> : null}
    {!selected && canEdit && available && <div className="portfolio-library-add-flow">
      <form action={action} className="portfolio-library-add-form"><input type="hidden" name="assetId" value={assetId} /><input type="hidden" name="intent" value="add" /><input type="hidden" name="confirmAdd" value="yes" />
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
