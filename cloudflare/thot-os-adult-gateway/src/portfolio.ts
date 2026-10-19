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

export function renderPortfolio(projection: PortfolioProjection, section: string | null, genre: string | null, requestSent: boolean) {
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
    <div class="portfolio-copy"><p class="portfolio-meta">${html(card.section)} · ${html(card.genre)}</p><h3>${html(card.title)}</h3><p>${html(card.description)}</p>${card.kind === "video" ? '<p class="portfolio-note">Preview clip · Full video by request</p>' : ""}</div>
  </article>`).join("");
  return `<section class="portfolio" aria-labelledby="portfolio-heading"><details${section || genre ? " open" : ""}><summary id="portfolio-heading"><span><small>THE COLLECTION</small><strong>Want a sneak peek?</strong><em>Browse selected previews</em></span><span class="portfolio-arrow" aria-hidden="true">↗</span></summary><div class="portfolio-inside"><p class="portfolio-intro">A little look at the collection. These are previews chosen for this page.</p><form class="portfolio-filters" method="get" action="/${slug}"><label>Section<select name="section">${["All sections", ...SECTIONS].map((value) => option(value, selectedSection)).join("")}</select></label><label>Genre<select name="genre">${["All genres", ...GENRES].map((value) => option(value, selectedGenre)).join("")}</select></label><button type="submit">Show selection</button></form><p class="portfolio-count">${cards.length} ${cards.length === 1 ? "preview" : "previews"}</p>${cards.length ? `<div class="portfolio-grid">${cardHtml}</div>` : '<p class="portfolio-empty">No previews match these filters. Try another section or genre.</p>'}<section class="portfolio-request" aria-labelledby="custom-heading"><div><small>MADE FOR YOU</small><h2 id="custom-heading">Have something in mind?</h2><p>Send a private custom request. Availability and price are confirmed separately.</p></div>${requestSent ? '<p role="status" class="portfolio-sent">Request received in this local preview.</p>' : ""}<form method="post" action="/${slug}/portfolio/request"><label>Request type<select name="requestType" required><option value="">Choose one</option><option value="photo">Photo set</option><option value="clip">Video clip</option><option value="other">Something else</option></select></label><label>Your request<textarea name="message" required minlength="10" maxlength="800" placeholder="Tell me what you have in mind"></textarea></label><label>Contact email <span>(optional in this local preview)</span><input name="email" type="email" maxlength="254" autocomplete="email"></label><label class="portfolio-ack"><input type="checkbox" name="acknowledge" value="yes" required><span>This is an enquiry only. Availability and price are not guaranteed.</span></label><button type="submit">Send request ↗</button></form></section></div></details></section>`;
}

export const portfolioCss = `
.portfolio{margin:2.5rem 0 0;text-align:left}
.portfolio details{border:1px solid #ffffff35;border-radius:1rem;background:#ffffff0c;overflow:hidden}
.portfolio summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1.35rem 1.4rem}
.portfolio summary::-webkit-details-marker{display:none}
.portfolio summary span:first-child{display:grid}
.portfolio summary small,.portfolio-request small{font-size:.7rem;letter-spacing:.18em;font-weight:800;opacity:.75}
.portfolio summary strong{font:700 clamp(1.65rem,5vw,2.4rem)/1.08 Georgia,serif;margin:.25rem 0}
.portfolio summary em{font-size:.85rem;font-style:normal;opacity:.72}
.portfolio-arrow{font-size:1.7rem;transition:transform .25s ease}
.portfolio details[open] .portfolio-arrow{transform:rotate(45deg)}
.portfolio-inside{border-top:1px solid #ffffff30;padding:1.25rem}
.portfolio-intro{margin:.25rem 0 1.25rem;opacity:.82}
.portfolio-filters{display:flex;flex-wrap:wrap;align-items:end;gap:.65rem}
.portfolio label{display:grid;gap:.35rem;font-size:.83rem;font-weight:700}
.portfolio select,.portfolio textarea,.portfolio input[type=email]{font:inherit;width:100%;border:1px solid #b8abb9;border-radius:.5rem;padding:.65rem;background:#fffaf7;color:#201c2d}
.portfolio-filters label{min-width:9rem;flex:1}
.portfolio button{font:inherit;font-weight:750;border:0;border-radius:.5rem;background:var(--portfolio-accent,#c5a4ff);color:var(--portfolio-bg,#170c24);padding:.7rem 1rem;cursor:pointer}
.portfolio-count{font-size:.8rem;opacity:.7;margin:1.2rem 0 .7rem}
.portfolio-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,16rem),1fr));gap:1rem}
.portfolio-card{border:1px solid #ffffff27;border-radius:.75rem;background:#ffffff0a;overflow:hidden;min-width:0;transition:transform .25s ease,box-shadow .25s ease}
.portfolio-card:hover{transform:translateY(-3px);box-shadow:0 12px 32px #0005}
.portfolio-card img,.portfolio-card video{width:100%;aspect-ratio:4/5;display:block;object-fit:cover;background:#352847}
.portfolio-copy{padding:1rem}
.portfolio-copy h3{font-size:1.1rem;line-height:1.2;margin:.3rem 0}
.portfolio-copy p{font-size:.84rem;margin:.4rem 0;opacity:.8}
.portfolio-copy .portfolio-meta{font-size:.7rem;text-transform:uppercase;letter-spacing:.1em}
.portfolio-copy .portfolio-note{color:var(--portfolio-accent,#d3baff);font-weight:750}
.portfolio-empty{border:1px dashed #ffffff70;padding:1rem;border-radius:.5rem}
.portfolio-request{margin-top:2rem;padding:1.25rem;border-top:1px solid #ffffff30;display:grid;gap:1rem}
.portfolio-request h2{font:700 1.8rem/1.1 Georgia,serif;margin:.5rem 0}
.portfolio-request p{font-size:.9rem;opacity:.8}
.portfolio-request form{display:grid;gap:.8rem}
.portfolio-request textarea{min-height:7rem;resize:vertical}
.portfolio-request label span{font-weight:400;opacity:.7}
.portfolio-request .portfolio-ack{display:flex;align-items:start;gap:.5rem;line-height:1.3}
.portfolio-request .portfolio-ack input{margin:.2rem 0;flex:none}
.portfolio-sent{padding:.75rem;background:#214b3c;border-radius:.5rem}
:focus-visible{outline:3px solid #f5a7c4;outline-offset:3px}
@media(max-width:34rem){.portfolio summary{padding:1rem}
.portfolio-inside{padding:1rem}
.portfolio-filters{display:grid}
.portfolio-grid{grid-template-columns:1fr}
.portfolio-card img,.portfolio-card video{aspect-ratio:4/5}
}
@media(max-width:25rem){.portfolio-grid{grid-template-columns:1fr}
}
@media(prefers-reduced-motion:reduce){.portfolio-arrow,.portfolio-card{transition:none}
.portfolio-card:hover{transform:none}
}
`;
