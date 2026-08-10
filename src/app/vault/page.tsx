import Image from "next/image";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { createVaultUploadJobsAction, openLocalPlatformAction, retryVaultUploadJobAction, verifyVaultUploadJobAction } from "@/app/actions";
import { getActiveCreator } from "@/lib/current-creator";
import { getLibraryAssets, getMessagingConnections, getVaultUploadJobs } from "@/lib/db";
import "./vault.css";
import "./vault-controls.css";

export const dynamic="force-dynamic";
const photoExtensions=new Set(["jpg","jpeg","png","webp","heic"]);
const statusCopy:Record<string,string>={
  approved:"Waiting for the paired browser",
  claimed:"Transfer is in progress",
  staged:"Accepted by the native uploader; check the vault",
  verified:"Confirmed in the native vault",
  failed:"Needs attention before it can retry",
};

export default async function VaultPage({searchParams}:{searchParams:Promise<{notice?:string;error?:string;q?:string;safety?:string;destination?:string;status?:string}>}){
  const query=await searchParams;
  const creator=await getActiveCreator();
  const destinationFilter=query.destination||"paid_ready";
  const assetQuery={creatorId:creator.id,query:query.q||"",safety:query.safety||"",limit:120};
  const assets=destinationFilter==="paid_ready"
    ? [...new Map([...getLibraryAssets({...assetQuery,destination:"subscription"}),...getLibraryAssets({...assetQuery,destination:"ppv"})].map((asset)=>[asset.id,asset])).values()]
    : getLibraryAssets({...assetQuery,destination:destinationFilter==="all"?"":destinationFilter});
  const allJobs=getVaultUploadJobs(creator.id);
  const jobs=query.status?allJobs.filter((job)=>job.status===query.status):allJobs;
  const connections=getMessagingConnections(creator.id).filter((item)=>item.platform==="onlyfans"||item.platform==="fansly");
  const connectedPlatforms=new Set(connections.filter((item)=>item.status!=="not_connected").map((item)=>item.platform));
  return <main className="app-shell"><AppNav active="Vault uploads"/><section className="workspace vault-workspace">
    <header className="topbar"><div><span className="eyebrow">PRIVATE MEDIA STAGING</span><h1>{creator.name} vault uploads</h1><p className="page-subtitle">Stage selected source assets in a verified native vault. This does not publish, post or message the media.</p></div></header>
    {query.notice==="already_queued"&&<div className="connection-alert success">That asset is already queued or verified for the selected vault. No duplicate was created.</div>}
    {query.notice==="queued"&&<div className="connection-alert success">The selected vault upload was approved and added to the local queue.</div>}
    {query.notice==="retry_queued"&&<div className="connection-alert success">The failed upload was safely reset and returned to the queue.</div>}
    {query.notice==="verified"&&<div className="connection-alert success">The staged asset is now recorded as verified in the native vault.</div>}
    {query.error&&<div className="connection-alert error">{query.error}</div>}
    <div className="vault-open-controls">{connections.filter((item)=>item.account_id).map((connection)=><form action={openLocalPlatformAction} key={connection.id}><input type="hidden" name="accountId" value={connection.account_id??""}/><input type="hidden" name="destination" value="vault"/><button className="secondary-button" type="submit">Open {connection.platform==="onlyfans"?"OnlyFans":"Fansly"} vault</button></form>)}</div>
    <form className="library-tools vault-filter-form"><input name="q" defaultValue={query.q||""} placeholder="Search vault assets…"/><select name="safety" defaultValue={query.safety||""}><option value="">All safety</option><option value="needs_review">Needs review</option><option value="sfw">SFW</option><option value="nsfw">NSFW</option></select><select name="destination" defaultValue={destinationFilter}><option value="paid_ready">Paid-ready only</option><option value="subscription">Subscription</option><option value="ppv">PPV</option><option value="all">Show all assets</option></select><select name="status" defaultValue={query.status||""}><option value="">All queue states</option>{Object.keys(statusCopy).map((status)=><option value={status} key={status}>{status.replaceAll("_"," ")}</option>)}</select><button>Filter</button>{(query.q||query.safety||query.destination||query.status)&&<Link href="/vault">Clear</Link>}</form>
    <form action={createVaultUploadJobsAction} className="vault-builder">
      <section className="panel vault-destinations"><div className="panel-heading"><div><h2>1. Choose native vaults</h2><p>Each checked destination creates a separate creator-scoped upload.</p></div></div><div className="vault-platform-options">
        {(["onlyfans","fansly"] as const).map((platform)=><label key={platform} className={connectedPlatforms.has(platform)?"ready":"disabled"}><input type="checkbox" name="platforms" value={platform} disabled={!connectedPlatforms.has(platform)}/><strong>{platform==="onlyfans"?"OnlyFans":"Fansly"}</strong><small>{connectedPlatforms.has(platform)?"Verified local bridge":"Connect and verify first"}</small></label>)}
      </div></section>
      <section className="panel vault-assets"><div className="panel-heading"><div><h2>2. Select eligible content</h2><p>Every selected asset must include Subscription or PPV. Multi content also needs the confirmation below.</p></div><button className="primary-button" type="submit">Approve selected vault uploads</button></div>
        <div className="vault-asset-grid">{assets.map((asset)=>{const mediaUrl=`/api/media/${asset.relative_path.split("/").map(encodeURIComponent).join("/")}`;const destinations=asset.destinations?asset.destinations.split("|"):[];const eligible=destinations.includes("subscription")||destinations.includes("ppv");return <label className={`vault-asset ${eligible?"":"ineligible"}`} key={asset.id}><input type="checkbox" name="assetIds" value={asset.id} disabled={!eligible}/><div>{photoExtensions.has(asset.extension)?<Image src={mediaUrl} alt={asset.basename} fill sizes="160px" unoptimized/>:<video src={mediaUrl} muted preload="metadata"/>}</div><strong title={asset.basename}>{asset.basename}</strong><small>{eligible?`${destinations.includes("subscription")?"Subscription":""}${destinations.includes("subscription")&&destinations.includes("ppv")?" · ":""}${destinations.includes("ppv")?"PPV":""}${asset.is_multi?" · Multi":""}`:"Classify for Subscription or PPV first"}</small></label>})}</div>
        {!assets.length&&<div className="mini-empty">No paid-ready assets match these filters. <Link href="/library?destination=subscription">Classify assets in the Content Library →</Link></div>}
        <div className="vault-consent-attestation"><label><input type="checkbox" name="paidConsentConfirmed" value="yes"/><span><strong>Paid multi-content confirmation</strong>I confirm each participant&apos;s identity and paid-use consent/release have been verified. Supporting evidence is held in OnlyFans or Fansly.</span></label><div><label>Evidence held in<select name="evidencePlatform"><option value="onlyfans">OnlyFans</option><option value="fansly">Fansly</option></select></label><label>Optional audit note<input name="consentNote" placeholder="Where to find it, without copying private evidence"/></label></div><small>Required only when a selected asset has creator friends. THOT OS stores who confirmed it, when, and where the evidence is held.</small></div>
      </section>
    </form>
    <section className="panel vault-queue"><div className="panel-heading"><div><h2>Upload queue</h2><p>Native bridge receipts with manual confirmation where the platform cannot provide final proof.</p></div><b>{jobs.filter((job)=>job.status==="approved"||job.status==="claimed").length} active · {jobs.filter((job)=>job.status==="staged").length} to check</b></div>
      {jobs.map((job)=><article key={job.id}><span className={`vault-status ${job.status}`}>{job.status}</span><div><strong>{job.basename}</strong><small>{job.platform==="onlyfans"?"OnlyFans":"Fansly"} · {job.handle.startsWith("@")?job.handle:`@${job.handle}`} · {(job.bytes/1024/1024).toFixed(1)} MB</small><small>{statusCopy[job.status]??job.status}</small>{job.error&&<em>{job.error}</em>}</div><div className="vault-job-actions"><time>{job.completed_at??job.created_at}</time>{job.status==="failed"&&<form action={retryVaultUploadJobAction}><input type="hidden" name="jobId" value={job.id}/><button className="secondary-button" type="submit">Retry</button></form>}{job.status==="staged"&&<form action={verifyVaultUploadJobAction}><input type="hidden" name="jobId" value={job.id}/><button className="primary-button" type="submit">Confirm in vault</button></form>}</div></article>)}
      {!jobs.length&&<div className="mini-empty">No vault uploads have been approved yet.</div>}
    </section>
  </section></main>;
}
