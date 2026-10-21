"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { VerifiedVideoPreview } from "./verified-video-preview";
import { VideoPosterEditor } from "./video-poster-editor";

type Card = { assetId: string; basename: string; title: string; description: string; categoryId: string | null;
  fullLengthAssetId: string | null; video: boolean; legacy: boolean; safety: "sfw" | "nsfw" | null; sourceAvailable: boolean;
  visible: boolean; mediaReady: boolean; previewKey: string | null; imageUrl: string | null };
type Category = { id: string; name: string; sort_order: number };
type Contact = { telegramUsername: string; email: string; message: string };
type Action = (form: FormData) => Promise<void>;

export function PortfolioEditor({ creatorName, revision, cards: initialCards, initialContact, categories, fullVideos, canEdit,
  publishingEnabled, profileReady, saveAction, publishAction, createCategoryAction, renameCategoryAction, synthetic = false }: {
  creatorName: string; revision: number; cards: Card[]; initialContact: Contact; categories: Category[];
  fullVideos: { id: string; basename: string }[]; canEdit: boolean; publishingEnabled: boolean; profileReady: boolean;
  saveAction: Action; publishAction: Action; createCategoryAction: Action; renameCategoryAction: Action; synthetic?: boolean;
}) {
  const [cards, setCards] = useState(initialCards);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [contact, setContact] = useState(initialContact);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const bypassLeave = useRef(false);
  const shape = (items: Card[]) => items.map(({ assetId, title, description, categoryId, fullLengthAssetId, previewKey, visible }) =>
    ({ assetId, title, description, categoryId, fullLengthAssetId, previewKey, visible }));
  const composition = useMemo(() => JSON.stringify({ revision, cards: shape(cards), contact }), [cards, contact, revision]);
  const original = useMemo(() => JSON.stringify({ revision, cards: shape(initialCards), contact: initialContact }), [initialCards, initialContact, revision]);
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
  const shown = cards.filter((card) => card.visible);
  const ready = shown.length > 0 && cards.every((card, index) => !card.visible || issues[index].startsWith("Ready"));
  const linked = shown.some((card) => card.fullLengthAssetId);
  const contactReady = !linked || Boolean(contact.telegramUsername.trim() || contact.email.trim());
  const filteredCards = cards.map((card, index) => ({ card, index })).filter(({ card }) => !categoryFilter || card.categoryId === categoryFilter);

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
    <section className="panel portfolio-taxonomy"><details open={categories.length === 0}><summary><strong>Categories</strong> <small>Group your cards for visitors</small></summary>
      <p>Add or rename categories here, then filter the cards below. Category names save privately. Save layout edits before changing a name.</p>
      {canEdit && categories.map((category) => <form action={renameCategoryAction} className="portfolio-label-create" key={category.id}><input type="hidden" name="id" value={category.id} /><label>Rename category<input name="name" maxLength={50} defaultValue={category.name} required disabled={dirty} /></label><button className="secondary-action" disabled={dirty}>Rename</button></form>)}
      {canEdit && <form action={createCategoryAction} className="portfolio-label-create"><label>New category<input name="name" maxLength={50} placeholder="e.g. Clips" required disabled={dirty} /></label><button className="secondary-action" disabled={dirty}>Add category</button></form>}
    </details></section>
    <section className="panel portfolio-visual-preview" aria-labelledby="portfolio-layout-title">
      <div className="section-heading"><div><h2 id="portfolio-layout-title">Your private layout</h2><p>All cards marked Show, across every category, appear on More after you publish. Hidden cards stay in this draft. Nothing live changes until then.</p></div>
        <span className="portfolio-preview-state">{dirty ? "Unsaved changes" : "Draft saved"}</span></div>
      <div className="portfolio-preview-frame"><div className="portfolio-preview-frame-heading"><span>18+ PORTFOLIO</span><strong>{creatorName}</strong><small>Private preview</small></div>
        {cards.length > 0 && <div className="portfolio-bulk-toolbar"><label>Filter cards by category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">All categories</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><span>{filteredCards.length} of {cards.length} cards · filter only changes this view</span></div>}
        {cards.length === 0 ? <div className="empty"><b>No cards yet</b><span>Add a photo or short clip from the Content Library.</span></div>
          : filteredCards.length === 0 ? <div className="empty">No cards in this category.</div>
          : <div className="portfolio-preview-grid portfolio-editor-grid">{filteredCards.map(({ card, index }) => <article className="portfolio-preview-card portfolio-editable-card" key={card.assetId}>
            <div className="portfolio-preview-image">{card.video
              ? synthetic ? <img src={card.imageUrl ?? ""} alt={`Synthetic preview poster for ${card.title}`} />
                : <VerifiedVideoPreview assetId={card.assetId} basename={card.basename} className="portfolio-preview-media" poster={card.imageUrl ?? undefined} />
              : card.imageUrl ? <img src={card.imageUrl} alt={`Private draft preview for ${card.title}`} loading="lazy" /> : <span>Preview preparing</span>}</div>
            <div className="portfolio-preview-card-body"><span className={card.visible ? "portfolio-readiness is-ready" : "portfolio-readiness"}>{card.visible ? "Shown on next publish" : "Hidden from next publish"}</span><span className={issues[index].startsWith("Ready") ? "portfolio-readiness is-ready" : "portfolio-readiness"}>{issues[index]}</span>
              <h3>{card.title}</h3><small>{categories.find((category) => category.id === card.categoryId)?.name ?? "Category needed"}</small>
              {canEdit && <div className="portfolio-card-controls"><button type="button" aria-pressed={card.visible} onClick={() => update(card.assetId, { visible: !card.visible })}>{card.visible ? "Hide on next publish" : "Show on next publish"}</button><button type="button" onClick={() => move(index, -1)} disabled={Boolean(categoryFilter) || index === 0} title={categoryFilter ? "Clear the category filter to reorder cards" : undefined} aria-label={`Move ${card.title} earlier`}>↑ Earlier</button>
                <button type="button" onClick={() => move(index, 1)} disabled={Boolean(categoryFilter) || index === cards.length - 1} title={categoryFilter ? "Clear the category filter to reorder cards" : undefined} aria-label={`Move ${card.title} later`}>↓ Later</button></div>}
              {canEdit && <details className="portfolio-card-edit-details"><summary>Edit card details</summary><div className="portfolio-card-fields"><label>Card title<input value={card.title} maxLength={100} onChange={(event) => update(card.assetId, { title: event.target.value })} /></label>
                <label>Category<select value={card.categoryId ?? ""} onChange={(event) => update(card.assetId, { categoryId: event.target.value || null })}><option value="">Choose category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
                <label>Description <span>(optional)</span><textarea value={card.description} maxLength={280} onChange={(event) => update(card.assetId, { description: event.target.value })} /></label>
                <label>Private full-length video <span>(optional)</span><select value={card.fullLengthAssetId ?? ""} onChange={(event) => update(card.assetId, { fullLengthAssetId: event.target.value || null })}><option value="">Preview only · no full-length request</option>
                  {fullVideos.filter((video) => video.id !== card.assetId).map((video) => <option value={video.id} key={video.id}>{video.basename}</option>)}</select></label>
                <p className="portfolio-field-note">A linked full video stays private. Visitors can only request it using your contact method.</p>
                <button type="button" className="danger-action" onClick={() => setCards((current) => current.filter((item) => item.assetId !== card.assetId))}>Remove from draft</button>
                <Link href={synthetic ? "/library/local-fixture?safety=nsfw&added=1" : `/library/${encodeURIComponent(card.assetId)}`}>Review Library item →</Link></div>
                {card.video && !synthetic && (!dirty ? <div className="portfolio-poster-step"><VideoPosterEditor assetId={card.assetId} label="Clip thumbnail" posterUrl={card.imageUrl} /><small>Thumbnail saves privately in the Library. Publish again to change the live thumbnail.</small></div>
                  : <small>Save this draft before changing a clip thumbnail.</small>)}
              </details>}
            </div></article>)}</div>}
      </div>
      {error && <p className="portfolio-publish-attention" role="alert">{error}</p>}
    </section>
    <section className="panel portfolio-publish" aria-labelledby="portfolio-contact-title"><div className="section-heading"><div><h2 id="portfolio-contact-title">How visitors contact you</h2><p>Enter the contact details and message visitors can use for full-length requests. They stay private in the draft until you publish.</p></div></div>
      {canEdit ? <div className="portfolio-release-contact">
        <label>Telegram username<input value={contact.telegramUsername} onChange={(event) => setContact((current) => ({ ...current, telegramUsername: event.target.value }))} maxLength={33} placeholder="@creatorname" /></label>
        <label>Contact email<input type="email" value={contact.email} onChange={(event) => setContact((current) => ({ ...current, email: event.target.value }))} maxLength={254} placeholder="creator@example.com" /></label>
        <label className="portfolio-contact-message">Custom request message <span>(optional)</span><textarea value={contact.message} onChange={(event) => setContact((current) => ({ ...current, message: event.target.value }))} maxLength={500} rows={4} placeholder={`Hello ${creatorName}, I would love to see the full length. Could you send me a payment option and download link?`} /></label>
        <div className="portfolio-contact-sample"><strong>Visitor message preview</strong><p>{contact.message.trim() || `Hello ${creatorName}, I would love to see the full length. Could you send me a payment option and download link?`}</p><small>The selected preview title and reference are appended when a visitor prepares a message. Visitors review it in Telegram or their email app before sending.</small></div>
      </div> : <p>Only an editor can change the creator contact details.</p>}
    </section>
    <section className="panel portfolio-publish" aria-labelledby="portfolio-publish-title"><div className="section-heading"><div><h2 id="portfolio-publish-title">Publish this layout</h2><p>Publishing uses all cards marked Show across every category, in their saved order. The category filter only changes your view. Unsaved edits are included. No private original is made public.</p></div><span className="portfolio-public-state">Final approval</span></div>
      {!profileReady && publishingEnabled && <p className="portfolio-publish-attention">Publish your <Link href="/adult-profile">18+ profile</Link> first.</p>}
      {!ready && <p className="portfolio-publish-attention">Show at least one ready card. Hidden and incomplete cards can remain in your private draft.</p>}
      {canEdit && <div className="portfolio-editor-save"><button className="secondary-action" type="button" onClick={() => send(saveAction, new FormData())} disabled={!dirty || pending}>Save Draft</button><span>{dirty ? "Your changes are only on this screen." : "Saved privately. Your live More page is unchanged."}</span></div>}
      {canEdit && publishingEnabled ? <form onSubmit={(event) => { event.preventDefault(); send(publishAction, new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter)); }} className="portfolio-release-form">
        {linked && !contactReady && <p className="portfolio-publish-attention">Add a Telegram username or email above for full-length requests.</p>}
        <p className="portfolio-public-use-note">Publishing shows the {shown.length} shown previews and thumbnails on your age-gated More page. Hidden cards stay in the draft. By publishing, you confirm you have the rights and consent for this public use.</p>
        <button className="primary" type="submit" name="publicRightsApproved" value="yes" disabled={!ready || !profileReady || !contactReady || pending}>{pending ? "Checking publication…" : `Publish ${shown.length} ${shown.length === 1 ? "card" : "cards"} to More`}</button>
        <small>Final media, rights and consent checks run before anything goes live.</small>
      </form> : <p>{publishingEnabled ? "Your role cannot publish a Portfolio." : "Publishing is unavailable here. Your draft stays private."}</p>}
    </section>
  </>;
}
