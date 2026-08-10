import Image from "next/image";
import Link from "next/link";
import { createPostAction } from "@/app/actions";
import { AppNav } from "@/components/app-nav";
import { getAccounts, getLibraryAssets, getPeople } from "@/lib/db";
import { getActiveCreator } from "@/lib/current-creator";

export const dynamic = "force-dynamic";

const photoExtensions = new Set(["jpg", "jpeg", "png", "webp", "heic"]);
const supportedDestinations = [
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["threads", "Threads"],
  ["tiktok", "TikTok"],
  ["x", "X"],
  ["youtube", "YouTube"],
  ["reddit", "Reddit"],
  ["myroomz", "MyRoomz"],
  ["onlyfans", "OnlyFans"],
  ["fansly", "Fansly"],
] as const;

function destinationLabel(platform: string) {
  return supportedDestinations.find(([value]) => value === platform)?.[1] ?? platform;
}

function handleForPlatform(tags:string,platform:string){
  return tags.split(" · ").find((tag)=>tag.startsWith(`${platform}:`))?.slice(platform.length+1)||"";
}

export default async function NewContentPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; safety?:string;trait?:string;platform?:string; missing?: string }> }) {
  const { q = "", type = "all", safety="",trait="",platform="", missing = "" } = await searchParams;
  const creator = await getActiveCreator();
  const mediaType = type === "photos" || type === "videos" ? type : "all";
  const destination=platform==="onlyfans"||platform==="fansly"?"subscription":["instagram","facebook","threads","tiktok","x","reddit"].includes(platform)?platform:"";
  const assets = getLibraryAssets({ creatorId: creator.id, query: q, mediaType, safety,trait,destination,limit: 120 });
  const accounts = getAccounts(creator.id);
  const people = getPeople(creator.id);
  const configuredPlatforms = new Set(accounts.map((account) => account.platform));
  const missingDestinations = supportedDestinations.filter(([platform]) => !configuredPlatforms.has(platform));
  const missingFields = new Set(missing.split(",").filter(Boolean));
  const queryFor = (next: Record<string, string>) => new URLSearchParams({ ...(q ? { q } : {}), ...(mediaType !== "all" ? { type: mediaType } : {}), ...(safety?{safety}:{}),...(trait?{trait}:{}),...(platform?{platform}:{}), ...next }).toString();
  return (
    <main className="app-shell">
      <AppNav active="Content library" />
      <section className="workspace form-workspace">
        <Link className="back-link" href="/library">← Back to library</Link>
        <header className="form-header"><span className="eyebrow">{creator.name.toUpperCase()} · {platform?`${destinationLabel(platform).toUpperCase()} CREATE`:"POST BUILDER"}</span><h1>{platform?`Create for ${destinationLabel(platform)}`:"Prepare content"}</h1><p>Choose already-suitable assets, add the human context, then create a separate draft for every selected destination.</p></header>
        {missingFields.size > 0 && <div className="connection-alert error">Choose {[
          missingFields.has("asset") ? "at least one asset" : "",
          missingFields.has("destination") ? "a destination" : "",
          missingFields.has("notes") ? "creator notes" : "",
        ].filter(Boolean).join(", ")} before creating drafts.</div>}
        <nav className="library-tabs" aria-label="Media type">
          {[["all","All"],["photos","Photos"],["videos","Videos"]].map(([value,label]) => <Link key={value} className={mediaType === value ? "active" : ""} href={`/content/new?${queryFor({ type: value === "all" ? "" : value })}`}>{label}</Link>)}
        </nav>
        <form className="library-tools prepare-library-tools">
          <input type="hidden" name="type" value={mediaType === "all" ? "" : mediaType} />
          {platform&&<input type="hidden" name="platform" value={platform}/>}
          <input name="q" defaultValue={q} placeholder="Search filenames and folders…" />
          <select name="safety" defaultValue={safety} aria-label="Filter by safety"><option value="">All safety</option><option value="needs_review">Needs review</option><option value="sfw">SFW</option><option value="nsfw">NSFW</option></select>
          <select name="trait" defaultValue={trait} aria-label="Filter by trait"><option value="">All traits</option><option value="has_teaser">Has teaser</option><option value="is_teaser">Is teaser</option><option value="multi">Multi creator</option></select>
          <button>Filter</button>
          {(q || safety||trait|| mediaType !== "all") && <Link href={platform?`/content/new?platform=${platform}`:"/content/new"}>Clear</Link>}
        </form>
        <form action={createPostAction} className="content-form">
          <section className="form-panel">
            <div className="form-section-title"><span>1</span><div><h2>Choose content</h2><p>{assets.length} assets match the current filters</p></div></div>
            <div className="asset-picker">
              {assets.map((asset) => {
                const mediaUrl = `/api/media/${asset.relative_path.split("/").map(encodeURIComponent).join("/")}`;
                const tags=[asset.classification_safety?.toUpperCase()||"NEEDS REVIEW",...(asset.is_teaser?["TEASER"]:[]),...(asset.is_multi?["MULTI"]:[])];
                return <label className="pick-card" key={asset.id}>
                  <input type="checkbox" name="assetIds" value={asset.id} />
                  <div className="pick-image">{photoExtensions.has(asset.extension) ? <Image src={mediaUrl} alt="" fill sizes="110px" unoptimized /> : <video src={mediaUrl} muted preload="metadata" />}{!photoExtensions.has(asset.extension) && <span className="pick-video-pill">▶</span>}</div>
                  <span title={asset.basename}>{asset.basename}</span>
                  {tags.length > 0 && <div className="pick-tags">{tags.map((item) => <b key={item}>{item}</b>)}</div>}
                </label>;
              })}
            </div>
            {assets.length === 0 && <div className="mini-empty">No assets match the current filters.</div>}
          </section>
          <section className="form-panel">
            <div className="form-section-title"><span>2</span><div><h2>Context and destination</h2><p>This context outranks SEO metadata when captions are drafted</p></div></div>
            <div className="form-fields">
              <fieldset className="choice-field"><legend>Destinations <span className="required-note">(choose at least one)</span></legend><div className="choice-list">{accounts.filter((account)=>!platform||account.platform===platform).map((account) => <label key={account.id}><input type="checkbox" name="accountIds" value={account.id} defaultChecked={Boolean(platform&&account.platform===platform)}/> <span>{account.label}<small>{destinationLabel(account.platform)} · {account.handle}</small></span></label>)}</div>{!platform&&missingDestinations.length > 0 && <div className="missing-destinations"><span>Also supported</span>{missingDestinations.map(([missingPlatform, label]) => <Link key={missingPlatform} href={`/creators/${creator.id}#destination-setup`}>＋ {label}</Link>)}</div>}</fieldset>
              <fieldset className="choice-field"><legend>Creator friends present <span className="optional">(optional)</span></legend><div className="choice-list">{people.map((person) => {const relevantHandle=platform?handleForPlatform(person.tags,platform):"";return <label key={person.id}><input type="checkbox" name="personIds" value={person.id} /> <span>{person.stage_name || person.display_name}<small>{platform?(relevantHandle?`${destinationLabel(platform)} · ${relevantHandle}`:`No ${destinationLabel(platform)} handle — no tag will be offered`):(person.tags||"No tags recorded")}</small></span></label>})}{people.length === 0 && <Link className="add-person-link" href="/people">＋ Add creator friends and handles first</Link>}</div></fieldset>
              <label>Creator notes<textarea name="creatorNotes" required placeholder="What happened, location, mood, people present, and anything the managing agent should know…" /></label>
              <label>Planned time <span className="optional">(optional)</span><input type="datetime-local" name="scheduledAt" /></label>
            </div>
          </section>
          <div className="form-submit"><p>Each selected destination gets its own draft variant. Nothing publishes.</p><button className="primary-button">Create platform drafts →</button></div>
        </form>
      </section>
    </main>
  );
}
