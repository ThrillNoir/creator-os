"use client";

import Link from "next/link";
import { useState } from "react";

type Category = { id: string; name: string };
type Video = { id: string; basename: string };

export function PortfolioLibraryControl({ assetId, selected, available, canEdit, action, portfolioHref = "/portfolio", blockedReason,
  categories = [], fullVideos = [], selectedCategoryName, selectedFullLengthName }: {
  assetId: string; selected: boolean; available: boolean; canEdit: boolean;
  action: (form: FormData) => Promise<void>; portfolioHref?: string; blockedReason?: string;
  categories?: Category[]; fullVideos?: Video[]; selectedCategoryName?: string | null; selectedFullLengthName?: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const [categoryChoice, setCategoryChoice] = useState("");
  return <section className="panel portfolio-library-control"><div><h2>{selected ? "In your Portfolio draft" : "Add to Portfolio"}</h2>
    <p>{selected ? "Saved privately. This item is not live on your More page." : available ? "Choose its category and optional private full video here. One save adds the preview to your private draft." : blockedReason ?? "This item must finish verification before it can be added."} Public publication is a separate approval in Portfolio.</p>
    {selected && <p><strong>Category:</strong> {selectedCategoryName ?? "Needs review"} · <strong>Full-length link:</strong> {selectedFullLengthName ?? "None (preview only)"}</p>}</div>
    {selected ? <div className="portfolio-library-saved-actions">{canEdit && <form action={action}><input type="hidden" name="assetId" value={assetId} /><input type="hidden" name="intent" value="remove" />
      <button className="secondary-action" type="submit">Remove from private draft</button></form>}
      <Link className="secondary-action" href={portfolioHref}>Open Portfolio layout →</Link></div> : null}
    {!selected && canEdit && available && <div className="portfolio-library-add-flow">
      <label className="portfolio-library-add-toggle"><input type="checkbox" checked={adding} onChange={(event) => setAdding(event.target.checked)} />Add this preview to Portfolio</label>
      {adding && <form action={action} className="portfolio-library-add-form"><input type="hidden" name="assetId" value={assetId} /><input type="hidden" name="intent" value="add" /><input type="hidden" name="confirmAdd" value="yes" />
        <label>Category<select name="categoryChoice" value={categoryChoice} onChange={(event) => setCategoryChoice(event.target.value)} required>
          <option value="">Choose a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}<option value="__new__">+ Create a new category</option></select></label>
        {categoryChoice === "__new__" && <label>New category name<input name="newCategoryName" maxLength={50} required placeholder="e.g. Clips" /></label>}
        <label>Private full-length video <span>(optional)</span><select name="fullLengthAssetId" defaultValue=""><option value="">None · preview only</option>
          {fullVideos.filter((video) => video.id !== assetId).map((video) => <option value={video.id} key={video.id}>{video.basename}</option>)}</select></label>
        <p>A linked full video stays private. Visitors can request it only after you separately approve a public preview.</p>
        <button className="primary" type="submit">Save to private Portfolio draft</button>
      </form>}
    </div>}
  </section>;
}
