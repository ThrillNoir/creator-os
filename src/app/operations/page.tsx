import Link from "next/link";
import {AppNav} from "@/components/app-nav";
import {getActiveCreator} from "@/lib/current-creator";
import {getAccounts,getLibraryAssets,getPostPackages,getVaultUploadJobs} from "@/lib/db";
import {OPERATION_PLATFORMS,PLATFORM_CAPABILITIES} from "@/lib/platform-operations";

export const dynamic="force-dynamic";

type Health="healthy"|"needs_love"|"needs_attention"|"blocked";

export default async function OperationsPage(){
  const creator=await getActiveCreator();
  const accounts=getAccounts(creator.id);
  const posts=getPostPackages(creator.id);
  const vaultJobs=getVaultUploadJobs(creator.id);
  const cards=OPERATION_PLATFORMS.map((platform)=>{
    const config=PLATFORM_CAPABILITIES[platform];
    const platformAccounts=accounts.filter((account)=>config.accountPlatforms.includes(account.platform));
    const upcoming=posts.filter((post)=>config.accountPlatforms.includes(post.platform)&&post.status!=="published"&&Boolean(post.scheduled_at)).length;
    const eligible=config.key==="vault"
      ? [...new Map([...getLibraryAssets({creatorId:creator.id,destination:"subscription",limit:500}),...getLibraryAssets({creatorId:creator.id,destination:"ppv",limit:500})].map((asset)=>[asset.id,asset])).values()].length
      : config.destination?getLibraryAssets({creatorId:creator.id,destination:config.destination,limit:500}).length:0;
    const failedVault=config.key==="vault"?vaultJobs.filter((job)=>job.status==="failed").length:0;
    let health:Health="healthy";let reason=`${eligible} eligible assets · ${upcoming} upcoming`;
    if(!platformAccounts.length){health="needs_attention";reason="No account has been added";}
    else if(failedVault){health="blocked";reason=`${failedVault} vault upload${failedVault===1?"":"s"} failed`;}
    else if(platformAccounts.some((account)=>account.publishing_mode==="direct_api"&&account.connection_status!=="connected")){health="blocked";reason="Direct publishing connection needs attention";}
    else if(!eligible){health="needs_attention";reason="No assets are classified for this destination";}
    else if(!upcoming){health="needs_love";reason="No upcoming content is scheduled";}
    return {platform,config,platformAccounts,upcoming,eligible,health,reason};
  });
  const warnings=cards.filter((card)=>card.health!=="healthy");
  return <main className="app-shell"><AppNav active="Operations"/><section className="workspace operations-workspace">
    <header className="topbar"><div><span className="eyebrow">SUPER ADMIN HQ · ACCOUNT CONTROL</span><h1>{creator.name} operations</h1><p className="page-subtitle">See which accounts need attention, then enter the platform workspace to create, schedule and review performance.</p></div><Link className="primary-button button-link" href="/content/new">＋ Create content</Link></header>
    <section className="status-strip"><div><span className="metric-icon violet">◎</span><p><strong>{cards.length}</strong><small>Operational workspaces</small></p></div><div><span className="metric-icon green">✓</span><p><strong>{cards.filter((card)=>card.health==="healthy").length}</strong><small>Healthy</small></p></div><div><span className="metric-icon amber">♡</span><p><strong>{cards.filter((card)=>card.health==="needs_love").length}</strong><small>Need some love</small></p></div><div><span className="metric-icon orange">!</span><p><strong>{warnings.filter((card)=>card.health!=="needs_love").length}</strong><small>Need attention</small></p></div></section>
    {warnings.length>0&&<section className="panel operations-warning-panel"><div className="panel-heading"><div><h2>Account warnings</h2><p>Each warning is based on a visible account, content or queue condition.</p></div><b>{warnings.length} open</b></div><div>{warnings.map((card)=><Link href={`/operations/${card.platform}`} key={card.platform}><span className={`health-dot ${card.health}`}></span><strong>{card.config.label}</strong><small>{card.reason}</small><b>Open →</b></Link>)}</div></section>}
    <section className="operations-card-grid">{cards.map((card)=><Link className="operations-card" href={`/operations/${card.platform}`} key={card.platform}><div className={`operation-logo ${card.platform}`}>{card.config.shortLabel}</div><div className="operation-card-heading"><div><span>{card.platformAccounts.length} account{card.platformAccounts.length===1?"":"s"}</span><h2>{card.config.label}</h2></div><b className={`health-badge ${card.health}`}>{card.health==="needs_love"?"Needs some love":card.health.replaceAll("_"," ")}</b></div><p>{card.reason}</p><div><span><strong>{card.upcoming}</strong> upcoming</span><span><strong>{card.eligible}</strong> eligible assets</span></div><small>{card.config.publishing}</small></Link>)}</section>
    <section className="future-portal-flag"><div><span>FUTURE SHARED MODULES</span><h2>Creator Portal is deliberately not exposed yet</h2><p>Analytics, messaging, content submission, creator voice, personal details, creator library, creator-friend notes, finances and yearly Wrapped data will reuse these creator-scoped HQ modules later.</p></div><b>HQ first</b></section>
  </section></main>;
}
