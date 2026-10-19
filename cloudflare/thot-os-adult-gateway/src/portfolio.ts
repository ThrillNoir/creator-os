export type PortfolioCard = {
  id: string;
  title: string;
  description: string;
  section: "Photos" | "Clips" | "Behind the scenes";
  genre: "Portraits" | "Performance" | "Everyday";
  kind: "image" | "video";
  previewPath: string;
  posterPath?: string;
};

export type PortfolioProjection = {
  schemaVersion: 1;
  creatorSlug: string;
  publishedProfileVersionId: string;
  cards: PortfolioCard[];
};

const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SECTIONS = ["Photos", "Clips", "Behind the scenes"] as const;
const GENRES = ["Portraits", "Performance", "Everyday"] as const;

function onlyKeys(value: object, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function fixturePath(value: unknown, slug: string, id: string, extension: string) {
  return value === `/portfolio-fixture/${slug}/${id}.${extension}`;
}

// The delivery path here is deliberately local-fixture-only. A real publisher
// needs a separate approved derivative and session-bound media delivery route.
export function validPortfolio(value: unknown, slug: string, versionId: string): value is PortfolioProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const projection = value as Partial<PortfolioProjection>;
  if (!onlyKeys(projection, ["schemaVersion", "creatorSlug", "publishedProfileVersionId", "cards"]) ||
    projection.schemaVersion !== 1 || projection.creatorSlug !== slug || !ID.test(slug) ||
    projection.publishedProfileVersionId !== versionId || !Array.isArray(projection.cards) || projection.cards.length > 24) return false;
  const ids = new Set<string>();
  return projection.cards.every((card) => {
    if (!card || typeof card !== "object" || !onlyKeys(card, ["id", "title", "description", "section", "genre", "kind", "previewPath", "posterPath"]) ||
      !ID.test(card.id) || ids.has(card.id) || typeof card.title !== "string" || !card.title.trim() || card.title.length > 100 ||
      typeof card.description !== "string" || card.description.length > 280 ||
      !SECTIONS.includes(card.section) || !GENRES.includes(card.genre)) return false;
    ids.add(card.id);
    return card.kind === "image"
      ? card.posterPath === undefined && fixturePath(card.previewPath, slug, card.id, "svg")
      : card.kind === "video" && fixturePath(card.previewPath, slug, card.id, "mp4") && fixturePath(card.posterPath, slug, card.id, "svg");
  });
}

function html(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

export function fullLengthMessage(creatorName: string, previewId: string, clipTitle: string) {
  return `Hello ${creatorName},\nI would love to see the full length. Can you please send me a payment option and the download link?\n\nAsset ID: ${previewId}\nFull-length clip: ${clipTitle}`;
}

export function renderPortfolio(projection: PortfolioProjection, creatorName: string, section: string | null, genre: string | null, requestSent: boolean) {
  const selectedSection = section && SECTIONS.includes(section as typeof SECTIONS[number]) ? section : "All sections";
  const selectedGenre = genre && GENRES.includes(genre as typeof GENRES[number]) ? genre : "All genres";
  const cards = projection.cards.filter((card) =>
    (selectedSection === "All sections" || card.section === selectedSection) &&
    (selectedGenre === "All genres" || card.genre === selectedGenre));
  const slug = encodeURIComponent(projection.creatorSlug);
  const option = (label: string, selected: string) => `<option value="${label === "All sections" || label === "All genres" ? "" : html(label)}"${label === selected ? " selected" : ""}>${html(label)}</option>`;
  const cardHtml = cards.map((card) => `<article class="portfolio-card">
    ${card.kind === "video"
      ? `<video controls preload="none" playsinline poster="${card.posterPath}" aria-label="Preview clip: ${html(card.title)}"><source src="${card.previewPath}" type="video/mp4">Your browser cannot play this preview.</video>`
      : `<img src="${card.previewPath}" alt="${html(card.title)}: ${html(card.description)}" loading="lazy">`}
    <div class="portfolio-copy"><p class="portfolio-meta">${html(card.section)} · ${html(card.genre)}</p><h3>${html(card.title)}</h3><p>${html(card.description)}</p>${card.kind === "video" ? `<p class="portfolio-note">Preview clip · Full video by request</p><details class="portfolio-full-request"><summary>Message creator for full length <span aria-hidden="true">↗</span></summary><form method="post" action="/${slug}/portfolio/full-length/request"><input type="hidden" name="previewId" value="${html(card.id)}"><label>Your name<input name="name" type="text" required maxlength="80" autocomplete="name"></label><label>Contact the creator using<select name="contactMethod" required><option value="">Choose a contact method</option><option value="telegram">Telegram</option><option value="email">Email</option></select></label><label>Your message<textarea name="message" required minlength="10" maxlength="800" rows="7">${html(fullLengthMessage(creatorName, card.id, card.title))}</textarea></label><p>Your name is added to the prepared message. You will review and send it in Telegram or your email app.</p><button type="submit">Prepare message ↗</button></form></details>` : ""}</div>
  </article>`).join("");
  return `<section class="portfolio" aria-labelledby="portfolio-heading"><details${section || genre ? " open" : ""}><summary id="portfolio-heading"><span><small>THE COLLECTION</small><strong>Want a sneak peek?</strong><em>Browse selected previews</em></span><span class="portfolio-arrow" aria-hidden="true"></span></summary><div class="portfolio-inside"><p class="portfolio-intro">A little look at the collection. These are previews chosen for this page.</p><form class="portfolio-filters" method="get" action="/${slug}"><label>Section<select name="section">${["All sections", ...SECTIONS].map((value) => option(value, selectedSection)).join("")}</select></label><label>Genre<select name="genre">${["All genres", ...GENRES].map((value) => option(value, selectedGenre)).join("")}</select></label><button type="submit">Show selection</button></form><p class="portfolio-count">${cards.length} ${cards.length === 1 ? "preview" : "previews"}</p>${cards.length ? `<div class="portfolio-grid">${cardHtml}</div>` : '<p class="portfolio-empty">No previews match these filters. Try another section or genre.</p>'}<section class="portfolio-request" aria-labelledby="custom-heading"><div><small>MADE FOR YOU</small><h2 id="custom-heading">Have something in mind?</h2><p>Send a private custom request. Availability and price are confirmed separately.</p></div>${requestSent ? '<p role="status" class="portfolio-sent">Request received in this local preview.</p>' : ""}<form method="post" action="/${slug}/portfolio/request"><label>Request type<select name="requestType" required><option value="">Choose one</option><option value="photo">Photo set</option><option value="clip">Video clip</option><option value="other">Something else</option></select></label><label>Your request<textarea name="message" required minlength="10" maxlength="800" placeholder="Tell me what you have in mind"></textarea></label><label>Contact email <span>(optional in this local preview)</span><input name="email" type="email" maxlength="254" autocomplete="email"></label><label class="portfolio-ack"><input type="checkbox" name="acknowledge" value="yes" required><span>This is an enquiry only. Availability and price are not guaranteed.</span></label><button type="submit">Send request ↗</button></form></section></div></details></section>`;
}

export const portfolioCss = `
.portfolio{--portfolio-paper:#fffaf7;--portfolio-card:#fff;--portfolio-ink:#241f28;--portfolio-muted:#5f555c;--portfolio-blush:#ffb0cc;--portfolio-mint:#b3e9cc;margin:2.5rem 8px 0 0;color:var(--portfolio-ink);text-align:left}
.portfolio *{box-sizing:border-box}
.portfolio > details{border:3px solid var(--portfolio-ink);background:var(--portfolio-paper);box-shadow:8px 8px 0 var(--portfolio-ink)}
.portfolio > details > summary{min-height:112px;cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1.2rem 1.5rem;background:var(--portfolio-blush)}
.portfolio summary::-webkit-details-marker{display:none}
.portfolio > details > summary span:first-child{display:grid}
.portfolio > details > summary small,.portfolio-request small{font:850 .68rem/1.2 ui-monospace,monospace;letter-spacing:.14em}
.portfolio > details > summary strong{font:950 clamp(1.6rem,5vw,2.45rem)/1.03 ui-sans-serif,system-ui,sans-serif;letter-spacing:-.055em;margin:.3rem 0}
.portfolio > details > summary em{font-size:.85rem;font-style:normal;font-weight:650}
.portfolio-arrow{display:grid;place-items:center;flex:none;width:42px;height:42px;border:2px solid var(--portfolio-ink);background:var(--portfolio-card)}
.portfolio-arrow::after{content:"";width:11px;height:11px;border-right:3px solid var(--portfolio-ink);border-bottom:3px solid var(--portfolio-ink);transform:translateY(-3px) rotate(45deg);transition:transform .16s ease}
.portfolio > details[open] > summary{border-bottom:3px solid var(--portfolio-ink)}
.portfolio > details[open] > summary .portfolio-arrow::after{transform:translateY(3px) rotate(225deg)}
.portfolio-inside{padding:clamp(1rem,3vw,1.65rem)}
.portfolio-intro{margin:0 0 1.25rem;max-width:44rem;color:var(--portfolio-muted)}
.portfolio-filters{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;align-items:end;gap:.8rem}
.portfolio label{display:grid;gap:.4rem;font-size:.8rem;font-weight:850}
.portfolio select,.portfolio textarea,.portfolio input[type=email],.portfolio input[type=text]{font:inherit;width:100%;min-height:46px;border:2px solid var(--portfolio-ink);border-radius:0;padding:.65rem .75rem;background:var(--portfolio-card);color:var(--portfolio-ink)}
.portfolio textarea::placeholder{color:var(--portfolio-muted);opacity:1}
.portfolio button{min-height:46px;border:2px solid var(--portfolio-ink);border-radius:0;padding:.6rem 1rem;background:var(--portfolio-mint);box-shadow:4px 4px 0 var(--portfolio-ink);color:var(--portfolio-ink);font:850 .86rem/1.2 ui-sans-serif,system-ui,sans-serif;cursor:pointer;transition:transform .16s ease,box-shadow .16s ease}
.portfolio button:hover,.portfolio button:active{transform:translate(4px,4px);box-shadow:0 0 0 var(--portfolio-ink)}
.portfolio-count{margin:1.5rem 0 .8rem;color:var(--portfolio-muted);font:850 .7rem/1.2 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}
.portfolio-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,18rem),1fr));gap:1.25rem;padding:0 7px 8px 0}
.portfolio-card{min-width:0;overflow:hidden;border:3px solid var(--portfolio-ink);background:var(--portfolio-card);box-shadow:6px 6px 0 var(--portfolio-ink);transition:transform .16s ease,box-shadow .16s ease}
.portfolio-card:hover,.portfolio-card:active{transform:translate(6px,6px);box-shadow:0 0 0 var(--portfolio-ink)}
.portfolio-card img,.portfolio-card video{display:block;width:100%;aspect-ratio:4/5;object-fit:cover;border-bottom:3px solid var(--portfolio-ink);background:#352847}
.portfolio-copy{padding:1rem}
.portfolio-copy h3{margin:.55rem 0 .35rem;font-size:1.15rem;line-height:1.15;font-weight:900;letter-spacing:-.025em;overflow-wrap:anywhere}
.portfolio-copy p{margin:.4rem 0;color:var(--portfolio-muted);font-size:.84rem;line-height:1.45}
.portfolio-copy .portfolio-meta{display:inline-block;margin:0;padding:.3rem .4rem;border:1px solid var(--portfolio-ink);background:var(--portfolio-mint);color:var(--portfolio-ink);font:850 .63rem/1.2 ui-monospace,monospace;letter-spacing:.04em;text-transform:uppercase}
.portfolio-copy .portfolio-note{margin-top:.8rem;padding-left:.6rem;border-left:3px solid var(--portfolio-accent,#8bd49a);color:var(--portfolio-ink);font-weight:800}
.portfolio-full-request{margin-top:1rem;border-top:2px solid var(--portfolio-ink)}
.portfolio-full-request > summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:.5rem;padding:.8rem 0;color:var(--portfolio-ink);font-size:.84rem;font-weight:900}
.portfolio-full-request > summary span{font-size:1.1rem}
.portfolio-full-request[open] > summary{border-bottom:2px solid var(--portfolio-ink)}
.portfolio-full-request form{display:grid;gap:.8rem;padding:1rem 0 .3rem}
.portfolio-full-request textarea{min-height:10rem;resize:vertical;font-size:.78rem}
.portfolio-full-request form p{margin:0;font-size:.74rem}
.portfolio-full-request button{width:calc(100% - 4px);background:var(--portfolio-blush)}
.portfolio-empty{border:2px dashed var(--portfolio-ink);padding:1rem;background:var(--portfolio-card)}
.portfolio-request{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:clamp(1rem,3vw,2rem);margin-top:2rem;padding:clamp(1rem,3vw,1.5rem);border:3px solid var(--portfolio-ink);background:var(--portfolio-card)}
.portfolio-request h2{margin:.5rem 0;font:950 clamp(1.65rem,3vw,2.15rem)/1.05 ui-sans-serif,system-ui,sans-serif;letter-spacing:-.05em}
.portfolio-request p{font-size:.9rem;line-height:1.5;color:var(--portfolio-muted)}
.portfolio-request form{display:grid;gap:.9rem}
.portfolio-request textarea{min-height:8rem;resize:vertical}
.portfolio-request label span{font-weight:500;color:var(--portfolio-muted)}
.portfolio-request .portfolio-ack{display:flex;align-items:start;gap:.6rem;line-height:1.4}
.portfolio-request .portfolio-ack input{flex:none;width:18px;height:18px;margin:.1rem 0;accent-color:var(--portfolio-ink)}
.portfolio-request button{justify-self:start;background:var(--portfolio-blush)}
.portfolio-sent{grid-column:1/-1;margin:0;padding:.75rem;border:2px solid var(--portfolio-ink);background:var(--portfolio-mint);color:var(--portfolio-ink);font-weight:800}
.portfolio :focus-visible{outline:3px solid var(--portfolio-ink);outline-offset:4px}
@media(max-width:44rem){.portfolio-request{grid-template-columns:1fr}}
@media(max-width:34rem){.portfolio{margin-right:6px}.portfolio > details > summary{min-height:95px;padding:1rem}.portfolio-inside{padding:1rem}.portfolio-filters{grid-template-columns:1fr}.portfolio-filters button{width:calc(100% - 4px)}.portfolio-grid{grid-template-columns:1fr}.portfolio-request button{width:calc(100% - 4px)}}
@media(prefers-reduced-motion:reduce){.portfolio-arrow::after,.portfolio-card,.portfolio button{transition:none}.portfolio-card:hover,.portfolio-card:active,.portfolio button:hover,.portfolio button:active{transform:none}.portfolio-card:hover,.portfolio-card:active{box-shadow:6px 6px 0 var(--portfolio-ink)}.portfolio button:hover,.portfolio button:active{box-shadow:4px 4px 0 var(--portfolio-ink)}}
`;
