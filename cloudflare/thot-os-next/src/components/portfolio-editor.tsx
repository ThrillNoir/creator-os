"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { VerifiedVideoPreview } from "./verified-video-preview";
import { VideoPosterEditor } from "./video-poster-editor";

type Card = { assetId: string; basename: string; title: string; description: string; categoryId: string | null;
  fullLengthAssetId: string | null; video: boolean; legacy: boolean; safety: "sfw" | "nsfw" | null; sourceAvailable: boolean;
  mediaReady: boolean; previewKey: string | null; imageUrl: string | null };
type Category = { id: string; name: string; sort_order: number };
type Action = (form: FormData) => Promise<void>;

export function PortfolioEditor({ creatorName, revision, cards: initialCards, categories, fullVideos, canEdit,
  publishingEnabled, profileReady, saveAction, publishAction, createCategoryAction, renameCategoryAction, synthetic = false }: {
  creatorName: string; revision: number; cards: Card[]; categories: Category[];
  fullVideos: { id: string; basename: string }[]; canEdit: boolean; publishingEnabled: boolean; profileReady: boolean;
  saveAction: Action; publishAction: Action; createCategoryAction: Action; renameCategoryAction: Action; synthetic?: boolean;
}) {
  const [cards, setCards] = useState(initialCards);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkCategory, setBulkCategory] = useState("");
  const [telegram, setTelegram] = useState("");
  const [email, setEmail] = useState("");
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const bypassLeave = useRef(false);
  const shape = (items: Card[]) => items.map(({ assetId, title, description, categoryId, fullLengthAssetId, previewKey }) =>
    ({ assetId, title, description, categoryId, fullLengthAssetId, previewKey }));
  const composition = useMemo(() => JSON.stringify({ revision, cards: shape(cards) }), [cards, revision]);
  const original = useMemo(() => JSON.stringify({ revision, cards: shape(initialCards) }), [initialCards, revision]);
  const dirty = composition !== original;
  const issues = cards.map((card) => {
    if (card.legacy) return "Old full-video draft · add its short clip from the Library";
    if (!card.sourceAvailable) return "Preview unavailable in the Library";
    if (card.safety !== "nsfw") return "Mark this preview 18+ in the Library";
    if (!card.categoryId) return "Choose a category";
    if (/[<>]/.test(categories.find((category) => category.id === card.categoryId)?.name ?? "")) return "Rename this category before publishing";
    if (!card.mediaReady) return card.video ? "Choose a thumbnail for this clip" : "Image preview is preparing";
    return "Ready for final media and consent checks";
  });
  const ready = cards.length > 0 && issues.every((issue) => issue.startsWith("Ready"));
  const linked = cards.some((card) => card.fullLengthAssetId);
  const contactReady = !linked || Boolean(telegram.trim() || email.trim());

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (bypassLeave.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.origin !== location.origin ||
        (anchor.pathname === location.pathname && anchor.search === location.search)) return;
      if (!window.confirm("You have unsaved Portfolio changes. Leave and discard them?")) event.preventDefault();
      else bypassLeave.current = true;
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true); };
  }, [dirty]);

  function update(id: string, patch: Partial<Card>) { setCards((current) => current.map((card) => card.assetId === id ? { ...card, ...patch } : card)); }
  function move(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= cards.length) return;
    setCards((current) => { const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; });
  }
  function send(action: Action, data: FormData) {
    setError("");
    data.set("composition", composition);
    startTransition(async () => {
      bypassLeave.current = true;
      try { await action(data); }
      catch (cause) { bypassLeave.current = false; setError(cause instanceof Error ? cause.message : "The draft could not be saved. Your edits are still here."); }
    });
  }

  return <>
    <section className="panel portfolio-visual-preview" aria-labelledby="portfolio-layout-title">
      <div className="section-heading"><div><h2 id="portfolio-layout-title">Your private layout</h2><p>Cards appear in this order on More after you publish. Changes here are private until you approve them.</p></div>
        <span className="portfolio-preview-state">{dirty ? "Unsaved changes" : "Draft saved"}</span></div>
      <div className="portfolio-preview-frame"><div className="portfolio-preview-frame-heading"><span>18+ PORTFOLIO</span><strong>{creatorName}</strong><small>Private preview</small></div>
        {canEdit && cards.length > 0 && <div className="portfolio-bulk-toolbar"><div className="portfolio-bulk-selection"><strong>{selected.length} selected</strong>
          <button className="secondary-action" type="button" onClick={() => setSelected(selected.length === cards.length ? [] : cards.map((card) => card.assetId))}>{selected.length === cards.length ? "Clear selection" : "Select all"}</button>
          <span>Select cards to give them the same category.</span></div>
          <label>Category for selected cards<select value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value)}><option value="">Choose category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
          <button className="secondary-action" type="button" disabled={!selected.length || !bulkCategory} onClick={() => { setCards((current) => current.map((card) => selected.includes(card.assetId) ? { ...card, categoryId: bulkCategory } : card)); setSelected([]); setBulkCategory(""); }}>Apply category</button></div>}
        {cards.length === 0 ? <div className="empty"><b>No cards yet</b><span>Add a photo or short clip from the Content Library.</span></div>
          : <div className="portfolio-preview-grid portfolio-editor-grid">{cards.map((card, index) => <article className="portfolio-preview-card portfolio-editable-card" key={card.assetId}>
            {canEdit && <label className="portfolio-preview-select"><input type="checkbox" checked={selected.includes(card.assetId)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, card.assetId] : current.filter((id) => id !== card.assetId))} />Select</label>}
            <div className="portfolio-preview-image">{card.video
              ? synthetic ? <img src={card.imageUrl ?? ""} alt={`Synthetic preview poster for ${card.title}`} />
                : <VerifiedVideoPreview assetId={card.assetId} basename={card.basename} className="portfolio-preview-media" poster={card.imageUrl ?? undefined} />
              : card.imageUrl ? <img src={card.imageUrl} alt={`Private draft preview for ${card.title}`} loading="lazy" /> : <span>Preview preparing</span>}</div>
            <div className="portfolio-preview-card-body"><span className={issues[index].startsWith("Ready") ? "portfolio-readiness is-ready" : "portfolio-readiness"}>{issues[index]}</span>
              <h3>{card.title}</h3><small>{categories.find((category) => category.id === card.categoryId)?.name ?? "Category needed"}</small>
              {canEdit && <div className="portfolio-card-controls"><button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${card.title} earlier`}>↑ Earlier</button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === cards.length - 1} aria-label={`Move ${card.title} later`}>↓ Later</button></div>}
              {canEdit && <details className="portfolio-card-edit-details"><summary>Edit card details</summary><div className="portfolio-card-fields"><label>Card title<input value={card.title} maxLength={100} onChange={(event) => update(card.assetId, { title: event.target.value })} /></label>
                <label>Category<select value={card.categoryId ?? ""} onChange={(event) => update(card.assetId, { categoryId: event.target.value || null })}><option value="">Choose category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
                <label>Description <span>(optional)</span><textarea value={card.description} maxLength={280} onChange={(event) => update(card.assetId, { description: event.target.value })} /></label>
                <label>Private full-length video <span>(optional)</span><select value={card.fullLengthAssetId ?? ""} onChange={(event) => update(card.assetId, { fullLengthAssetId: event.target.value || null })}><option value="">Preview only · no full-length request</option>
                  {fullVideos.filter((video) => video.id !== card.assetId).map((video) => <option value={video.id} key={video.id}>{video.basename}</option>)}</select></label>
                <p className="portfolio-field-note">A linked full video stays private. Visitors can only request it using your contact method.</p>
                <button type="button" className="danger-action" onClick={() => { setCards((current) => current.filter((item) => item.assetId !== card.assetId)); setSelected((current) => current.filter((id) => id !== card.assetId)); }}>Remove from draft</button>
                <Link href={synthetic ? "/library/local-fixture?safety=nsfw&added=1" : `/library/${encodeURIComponent(card.assetId)}`}>Review Library item →</Link></div>
                {card.video && !synthetic && (!dirty ? <div className="portfolio-poster-step"><VideoPosterEditor assetId={card.assetId} label="Clip thumbnail" posterUrl={card.imageUrl} /><small>Thumbnail saves privately in the Library. Publish again to change the live thumbnail.</small></div>
                  : <small>Save this draft before changing a clip thumbnail.</small>)}
              </details>}
            </div></article>)}</div>}
      </div>
      {canEdit && <div className="portfolio-editor-save"><button className="secondary-action" type="button" onClick={() => send(saveAction, new FormData())} disabled={!dirty || pending}>Save Draft</button><span>{dirty ? "Your changes are only on this screen." : "Saved privately. Your live More page is unchanged."}</span></div>}
      {error && <p className="portfolio-publish-attention" role="alert">{error}</p>}
    </section>
    <section className="panel portfolio-taxonomy"><details open={categories.length === 0}><summary><strong>Categories</strong> <small>Group your cards for visitors</small></summary>
      <p>Category names save privately when added or renamed. Save layout edits above first.</p>
      {canEdit && categories.map((category) => <form action={renameCategoryAction} className="portfolio-label-create" key={category.id}><input type="hidden" name="id" value={category.id} /><label>Rename category<input name="name" maxLength={50} defaultValue={category.name} required disabled={dirty} /></label><button className="secondary-action" disabled={dirty}>Rename</button></form>)}
      {canEdit && <form action={createCategoryAction} className="portfolio-label-create"><label>New category<input name="name" maxLength={50} placeholder="e.g. Clips" required disabled={dirty} /></label><button className="secondary-action" disabled={dirty}>Add category</button></form>}
    </details></section>
    <section className="panel portfolio-publish" aria-labelledby="portfolio-publish-title"><div className="section-heading"><div><h2 id="portfolio-publish-title">Publish this layout</h2><p>Publishing uses exactly the cards and order shown above, including unsaved edits. No private original is made public.</p></div><span className="portfolio-public-state">Final approval</span></div>
      {!profileReady && publishingEnabled && <p className="portfolio-publish-attention">Publish your <Link href="/adult-profile">18+ profile</Link> first.</p>}
      {!ready && <p className="portfolio-publish-attention">Finish or remove cards marked above before publishing. Incomplete cards can remain in a private draft.</p>}
      {canEdit && publishingEnabled ? <form onSubmit={(event) => { event.preventDefault(); send(publishAction, new FormData(event.currentTarget)); }} className="portfolio-release-form">
        {linked && <div className="portfolio-release-contact"><h3>Contact for full-length requests</h3><p>Needed only for cards linked to a private full-length video.</p>
          <label>Telegram username<input name="telegramUsername" value={telegram} onChange={(event) => setTelegram(event.target.value)} placeholder="@creatorname" /></label>
          <label>Contact email<input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label></div>}
        <label className="portfolio-release-approval"><input type="checkbox" name="publicRightsApproved" value="yes" checked={approved} onChange={(event) => setApproved(event.target.checked)} />
          I confirm I have the right to publish these previews and thumbnails, and everyone shown has consented to this public use.</label>
        <button className="primary" type="submit" disabled={!ready || !profileReady || !contactReady || !approved || pending}>{pending ? "Checking publication…" : `Approve and publish ${cards.length} ${cards.length === 1 ? "card" : "cards"}`}</button>
        <small>Final media, rights and consent checks run before anything goes live.</small>
      </form> : <p>{publishingEnabled ? "Your role cannot publish a Portfolio." : "Publishing is unavailable here. Your draft stays private."}</p>}
    </section>
  </>;
}
