interface D1Result<T> { results:T[]; success:boolean }
interface D1Statement {
  bind(...values:unknown[]):D1Statement;
  all<T>():Promise<D1Result<T>>;
  first<T>():Promise<T|null>;
}
interface D1Database { prepare(query:string):D1Statement }
interface R2ObjectBody {
  body:ReadableStream;
  etag:string;
  httpMetadata?:{contentType?:string};
}
interface R2Bucket { head(key:string):Promise<unknown|null>;get(key:string):Promise<R2ObjectBody|null> }

interface Env {
  DB:D1Database;
  MEDIA:R2Bucket;
  PREVIEWS:R2Bucket;
  STAGING_ADMIN_TOKEN:string;
  ACCESS_AUD?:string;
  ACCESS_JWKS_URL?:string;
  ACCESS_ALLOWED_EMAIL?:string;
}

type CountRow={count:number};
type CreatorSummary={id:string;name:string;status:string;assets:number;sfw:number;nsfw:number;needs_review:number};
type DestinationSummary={destination:string;count:number};
type AssetRow={
  id:string;creator_id:string;relative_path:string;basename:string;extension:string;
  bytes:number;modified_at:string;classification_safety:string|null;destinations:string;preview_r2_key:string|null;
};

type AccessClaims={aud:string|string[];email?:string;exp?:number;nbf?:number};
type AccessJwk=JsonWebKey&{kid?:string};
let accessKeys:Promise<AccessJwk[]>|null=null;

function decodeBase64Url(value:string){
  const normalised=value.replaceAll("-","+").replaceAll("_","/").padEnd(Math.ceil(value.length/4)*4,"=");
  return Uint8Array.from(atob(normalised),(character)=>character.charCodeAt(0));
}

async function accessAuthorised(request:Request,env:Env){
  if(!env.ACCESS_AUD||!env.ACCESS_JWKS_URL||!env.ACCESS_ALLOWED_EMAIL)return true;
  const token=request.headers.get("cf-access-jwt-assertion");
  if(!token)return false;
  const parts=token.split(".");
  if(parts.length!==3)return false;
  try{
    const header=JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]))) as {alg?:string;kid?:string};
    const claims=JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1]))) as AccessClaims;
    if(header.alg!=="RS256"||!header.kid)return false;
    const now=Math.floor(Date.now()/1000);
    const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
    if(!audiences.includes(env.ACCESS_AUD)||!claims.exp||claims.exp<=now||(claims.nbf??0)>now)return false;
    if(claims.email?.toLowerCase()!==env.ACCESS_ALLOWED_EMAIL.toLowerCase())return false;
    accessKeys??=fetch(env.ACCESS_JWKS_URL).then(async(response)=>{
      if(!response.ok)throw new Error("Access keys unavailable");
      return ((await response.json()) as {keys:AccessJwk[]}).keys;
    });
    const jwk=(await accessKeys).find((key)=>key.kid===header.kid);
    if(!jwk)return false;
    const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,decodeBase64Url(parts[2]),new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  }catch{
    return false;
  }
}

function authorised(request:Request,env:Env){
  const token=env.STAGING_ADMIN_TOKEN?.trim();
  return Boolean(token)&&request.headers.get("authorization")===`Bearer ${token}`;
}

function json(body:unknown,status=200){
  return Response.json(body,{status,headers:{"cache-control":"no-store","x-content-type-options":"nosniff"}});
}

async function counts(env:Env){
  const [creators,assets,classifications,destinations]=await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM creators").first<CountRow>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM assets WHERE source_available=1").first<CountRow>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM asset_classifications").first<CountRow>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM asset_destinations").first<CountRow>(),
  ]);
  return {creators:creators?.count??0,assets:assets?.count??0,classifications:classifications?.count??0,destinations:destinations?.count??0};
}

async function creatorSummaries(env:Env){
  return (await env.DB.prepare(`
    SELECT c.id,c.name,c.status,COUNT(a.id) AS assets,
      SUM(CASE WHEN ac.safety='sfw' THEN 1 ELSE 0 END) AS sfw,
      SUM(CASE WHEN ac.safety='nsfw' THEN 1 ELSE 0 END) AS nsfw,
      SUM(CASE WHEN ac.safety IS NULL THEN 1 ELSE 0 END) AS needs_review
    FROM creators c LEFT JOIN assets a ON a.creator_id=c.id AND a.source_available=1
    LEFT JOIN asset_classifications ac ON ac.asset_id=a.id
    GROUP BY c.id,c.name,c.status ORDER BY c.name
  `).all<CreatorSummary>()).results;
}

async function destinationSummaries(env:Env,creatorId:string){
  return (await env.DB.prepare(`SELECT destination,COUNT(*) AS count FROM asset_destinations WHERE creator_id=? GROUP BY destination ORDER BY count DESC,destination`).bind(creatorId).all<DestinationSummary>()).results;
}

const allowedDestinations=new Set(["instagram","facebook","tiktok","threads","x","reddit","subscription","ppv"]);

async function libraryAssets(env:Env,creatorId:string,safety:string,destination:string){
  const conditions=["a.creator_id=?","a.source_available=1"];
  const values:string[]=[creatorId];
  if(safety==="review")conditions.push("c.safety IS NULL");
  if(safety==="sfw"||safety==="nsfw"){
    conditions.push("c.safety=?");
    values.push(safety);
  }
  if(allowedDestinations.has(destination)){
    conditions.push("EXISTS (SELECT 1 FROM asset_destinations filter_destination WHERE filter_destination.asset_id=a.id AND filter_destination.destination=?)");
    values.push(destination);
  }
  return (await env.DB.prepare(`
    SELECT a.id,a.creator_id,a.relative_path,a.basename,a.extension,a.bytes,a.modified_at,a.preview_r2_key,
      c.safety AS classification_safety,
      COALESCE((SELECT GROUP_CONCAT(d.destination,'|') FROM asset_destinations d WHERE d.asset_id=a.id),'') AS destinations
    FROM assets a LEFT JOIN asset_classifications c ON c.asset_id=a.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY (a.preview_r2_key IS NULL) ASC,a.modified_at DESC LIMIT 120
  `).bind(...values).all<AssetRow>()).results;
}

function escapeHtml(value:unknown){
  return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
}

const styles=`:root{color-scheme:dark;--bg:#0c0911;--panel:#17131e;--panel2:#201928;--line:#332840;--ink:#f7f3ff;--muted:#a79eb3;--purple:#7655f6;--purple2:#bcaeff}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px Inter,ui-sans-serif,system-ui,sans-serif}a{color:inherit;text-decoration:none}.shell{min-height:100vh;display:grid;grid-template-columns:250px 1fr}.sidebar{position:sticky;top:0;height:100vh;border-right:1px solid var(--line);padding:26px 18px;background:#100c16}.brand{display:flex;align-items:center;gap:12px;padding:0 10px 28px}.brand i{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:var(--purple);font-style:normal;font-weight:900}.brand strong,.brand span{display:block}.brand strong{font-size:17px}.brand span{font-size:11px;color:var(--muted);margin-top:3px}.nav-label{margin:24px 10px 8px;color:#786f84;font-size:10px;font-weight:800;letter-spacing:.14em}.nav a{display:flex;gap:10px;padding:11px 12px;border-radius:10px;color:#b9b1c4}.nav a:hover,.nav a.active{background:#241b30;color:white}.nav b{width:20px;color:var(--purple2)}.workspace{padding:42px;min-width:0}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.eyebrow{color:var(--purple2);font-size:11px;font-weight:800;letter-spacing:.14em}.top h1{font-size:38px;margin:10px 0 8px}.top p{color:var(--muted);margin:0}.stage{border:1px solid #453674;background:#21183a;color:#cfbfff;border-radius:999px;padding:9px 12px;font-size:10px;font-weight:800;letter-spacing:.08em}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:30px}.card,.panel{background:var(--panel);border:1px solid var(--line);border-radius:16px}.card{padding:22px}.card b,.card span{display:block}.card b{font-size:28px}.card span{color:var(--muted);margin-top:7px;text-transform:capitalize}.layout{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(300px,.7fr);gap:16px;margin-top:18px}.panel{padding:24px}.panel h2{margin:0 0 6px}.panel>p{color:var(--muted);margin:0 0 20px}.row{display:grid;grid-template-columns:1fr auto;gap:16px;padding:15px 0;border-top:1px solid var(--line)}.row strong,.row span,.row small{display:block}.row span,.row small{color:var(--muted);margin-top:5px}.state{color:#78d7a5;font-size:11px}.warning{border:1px solid #654b1d;background:#2a2112;color:#e8c881;border-radius:12px;padding:15px;line-height:1.5}.destinations{display:grid;grid-template-columns:1fr 1fr;gap:9px}.destination{display:flex;justify-content:space-between;background:var(--panel2);border-radius:10px;padding:12px}.creator{margin-top:18px}.creator-head{display:flex;justify-content:space-between;align-items:center}.creator-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:18px}.creator-stats span{background:var(--panel2);border-radius:9px;padding:12px;color:var(--muted)}.creator-stats b{display:block;color:var(--ink);font-size:19px;margin-bottom:4px}.roadmap li{color:var(--muted);padding:8px 0}.roadmap li.done{color:#78d7a5}.roadmap li.current{color:#d4c8ff}.filters{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}.filters a{padding:9px 12px;background:var(--panel2);border:1px solid var(--line);border-radius:9px;color:var(--muted)}.filters a.active{background:var(--purple);color:white}.asset-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.asset{overflow:hidden;padding:0}.asset-preview{aspect-ratio:4/5;background:#211b29;display:grid;place-items:center;color:var(--muted)}.asset-preview img{width:100%;height:100%;object-fit:cover}.asset-info{padding:13px}.asset-info strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.asset-info small{display:block;color:var(--muted);margin-top:6px}.pills{display:flex;gap:5px;flex-wrap:wrap;margin-top:9px}.pill{font-size:9px;background:#2b2235;color:#cbbdea;padding:4px 6px;border-radius:6px}.pill.sfw{color:#78d7a5}.pill.nsfw{color:#f0a7ba}@media(max-width:1100px){.asset-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:900px){.shell{grid-template-columns:1fr}.sidebar{position:relative;height:auto}.nav{display:flex;overflow:auto}.nav-label{display:none}.nav a{white-space:nowrap}.workspace{padding:26px}.grid{grid-template-columns:1fr 1fr}.layout{grid-template-columns:1fr}.asset-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:560px){.asset-grid{grid-template-columns:1fr}}`;

function nav(pathname:string){
  const links=[["⌂","Overview","/"],["▦","Content library","/library"],["◇","Creators","/creators"],["◷","Migration","/migration"]];
  return `<aside class="sidebar"><a class="brand" href="/"><i>T</i><div><strong>THOT OS</strong><span>Private agency workspace</span></div></a><nav class="nav"><p class="nav-label">CLOUDFLARE HQ</p>${links.map(([icon,label,href])=>`<a class="${pathname===href?"active":""}" href="${href}"><b>${icon}</b>${label}</a>`).join("")}</nav></aside>`;
}

function page(pathname:string,title:string,subtitle:string,body:string){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · THOT OS</title><style>${styles}</style></head><body><main class="shell">${nav(pathname)}<section class="workspace"><header class="top"><div><span class="eyebrow">THOT OS · CLOUDFLARE STAGING</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div><span class="stage">PRIVATE STAGING</span></header>${body}</section></main></body></html>`;
}

function html(body:string){
  return new Response(body,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","content-security-policy":"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
}

const worker={
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(request.method!=="GET")return json({ok:false,error:"method_not_allowed"},405);
    if(!await accessAuthorised(request,env))return json({ok:false,error:"access_identity_required"},401);

    if(url.pathname.startsWith("/preview/")){
      const objectId=url.pathname.slice("/preview/".length);
      if(!/^[a-f0-9]{64}$/.test(objectId))return json({ok:false,error:"preview_not_found"},404);
      const key=`creators/adelaide/assets/${objectId}/preview.jpg`;
      const asset=await env.DB.prepare("SELECT id FROM assets WHERE creator_id=? AND preview_r2_key=? AND source_available=1").bind("adelaide",key).first<{id:string}>();
      if(!asset)return json({ok:false,error:"preview_not_found"},404);
      const object=await env.PREVIEWS.get(key);
      if(!object)return json({ok:false,error:"preview_not_found"},404);
      return new Response(object.body,{headers:{
        "content-type":object.httpMetadata?.contentType||"image/jpeg",
        "cache-control":"private, max-age=86400",
        "etag":object.etag,
        "x-content-type-options":"nosniff",
      }});
    }

    if(url.pathname==="/"){
      const [summary,creators]=await Promise.all([counts(env),creatorSummaries(env)]);
      const cards=Object.entries(summary).map(([label,value])=>`<article class="card"><b>${value}</b><span>${label}</span></article>`).join("");
      const creatorRows=creators.map(item=>`<div class="row"><div><strong>${escapeHtml(item.name)}</strong><span>${item.assets} indexed assets · ${item.sfw} SFW · ${item.nsfw} NSFW</span></div><b class="state">${escapeHtml(item.status)}</b></div>`).join("");
      const body=`<section class="grid">${cards}</section><div class="layout"><section class="panel"><h2>Creator workspaces</h2><p>Cloudflare D1 records currently available to the hosted interface.</p>${creatorRows}</section><aside class="panel"><h2>Migration status</h2><p>The local app remains authoritative during staged cutover.</p><ol class="roadmap"><li class="done">D1 foundation and Adelaide import</li><li class="done">Cloudflare Access identity gate</li><li class="done">171 private R2 previews</li><li class="current">Full operational interface</li></ol></aside></div>`;
      return html(page(url.pathname,"Overview","Creator-scoped operations migrating safely onto Cloudflare.",body));
    }

    if(url.pathname==="/creators"){
      const creators=await creatorSummaries(env);
      const cards=creators.map(item=>`<article class="panel creator"><div class="creator-head"><div><span class="eyebrow">${escapeHtml(item.id)}</span><h2>${escapeHtml(item.name)}</h2></div><b class="state">${escapeHtml(item.status)}</b></div><div class="creator-stats"><span><b>${item.assets}</b>Assets</span><span><b>${item.sfw}</b>SFW</span><span><b>${item.nsfw}</b>NSFW</span><span><b>${item.needs_review}</b>Review</span></div></article>`).join("");
      return html(page(url.pathname,"Creators","Cloudflare workspaces remain strictly creator-scoped.",cards));
    }

    if(url.pathname==="/library"){
      const safety=url.searchParams.get("safety")||"all";
      const destination=url.searchParams.get("destination")||"all";
      const [creators,destinations,assets]=await Promise.all([creatorSummaries(env),destinationSummaries(env,"adelaide"),libraryAssets(env,"adelaide",safety,destination)]);
      const adelaide=creators.find(item=>item.id==="adelaide");
      const destinationCards=destinations.map(item=>`<div class="destination"><span>${escapeHtml(item.destination)}</span><b>${item.count}</b></div>`).join("");
      const safetyLinks=[["all","All safety"],["review","Needs review"],["sfw","SFW"],["nsfw","NSFW"]].map(([value,label])=>`<a class="${safety===value?"active":""}" href="/library?safety=${value}${allowedDestinations.has(destination)?`&destination=${destination}`:""}">${label}</a>`).join("");
      const destinationLinks=[["all","All destinations"],...[...allowedDestinations].map(value=>[value,value])].map(([value,label])=>`<a class="${destination===value?"active":""}" href="/library?destination=${value}${["review","sfw","nsfw"].includes(safety)?`&safety=${safety}`:""}">${escapeHtml(label)}</a>`).join("");
      const assetCards=assets.map(asset=>{
        const objectId=asset.preview_r2_key?.match(/\/([a-f0-9]{64})\/preview\.jpg$/)?.[1];
        const preview=objectId?`<img src="/preview/${objectId}" alt="" loading="lazy">`:`<span>Waiting for Dropbox download</span>`;
        const pills=[asset.classification_safety||"needs review",...asset.destinations.split("|").filter(Boolean)].map(value=>`<span class="pill ${escapeHtml(value)}">${escapeHtml(value)}</span>`).join("");
        return `<article class="card asset"><div class="asset-preview">${preview}</div><div class="asset-info"><strong title="${escapeHtml(asset.basename)}">${escapeHtml(asset.basename)}</strong><small>${Math.round(asset.bytes/1024)} KB · ${escapeHtml(asset.extension.toUpperCase())}</small><div class="pills">${pills}</div></div></article>`;
      }).join("");
      const body=`<section class="grid"><article class="card"><b>${adelaide?.assets??0}</b><span>Adelaide assets</span></article><article class="card"><b>${adelaide?.sfw??0}</b><span>SFW</span></article><article class="card"><b>${adelaide?.nsfw??0}</b><span>NSFW</span></article><article class="card"><b>${adelaide?.needs_review??0}</b><span>Needs review</span></article></section><section class="panel" style="margin-top:18px"><h2>Content Library</h2><p>Authenticated Adelaide assets with private R2 previews. ${assets.length} shown.</p><div class="filters">${safetyLinks}</div><div class="filters">${destinationLinks}</div><div class="asset-grid">${assetCards}</div></section><aside class="panel" style="margin-top:18px"><h2>Suitable destinations</h2><p>Classification totals imported from Adelaide.</p><div class="destinations">${destinationCards}</div></aside>`;
      return html(page(url.pathname,"Content Library","Adelaide's library foundation is now running from D1.",body));
    }

    if(url.pathname==="/migration"){
      const body=`<div class="layout"><section class="panel"><h2>Cloudflare cutover</h2><p>Each module is verified before writes move away from the local database.</p><ol class="roadmap"><li class="done">Rollback backup recorded</li><li class="done">THOT OS branding deployed</li><li class="done">Correct Cloudflare account pinned</li><li class="done">Adelaide metadata migrated to D1</li><li class="done">Private R2 buckets connected</li><li class="done">Cloudflare Access identity gate</li><li class="done">171 private R2 previews</li><li class="current">Full operational interface rollout</li><li>Approvals, scheduling and publishing</li><li>Messaging, analytics and finance</li></ol></section><aside class="panel"><h2>Safety boundary</h2><div class="warning">No live publishing authority, fan messages or private media originals have been moved into the hosted interface. Local THOT OS remains the rollback system.</div></aside></div>`;
      return html(page(url.pathname,"Migration","A visible, evidence-backed path from local HQ to Cloudflare.",body));
    }

    if(url.pathname==="/health"){
      return json({ok:true,service:"thot-os-staging",environment:"staging",database:await counts(env),bindings:{media:true,previews:true},timestamp:new Date().toISOString()});
    }

    if(url.pathname==="/api/library"){
      if(!authorised(request,env))return json({ok:false,error:"unauthorised"},401);
      const creatorId=url.searchParams.get("creator")?.trim()||"";
      if(!creatorId)return json({ok:false,error:"creator_required"},400);
      return json({ok:true,creatorId,assets:await libraryAssets(env,creatorId,"all","all")});
    }

    return json({ok:false,error:"not_found",service:"thot-os-staging"},404);
  },
};

export default worker;
