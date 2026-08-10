import { AppNav } from "@/components/app-nav";
import { getActiveCreator } from "@/lib/current-creator";
import { getRecentAutomationEvents, getRecentWorkflowReceipts } from "@/lib/db";
import { retryAutomationEventAction } from "./actions";

export const dynamic="force-dynamic";

function formatDetail(value:string){
  try{
    const parsed=JSON.parse(value) as Record<string,unknown>;
    return Object.entries(parsed).map(([key,item])=>`${key}: ${String(item)}`).join(" · ")||"No additional detail";
  }catch{return value||"No additional detail";}
}

export default async function AutomationPage(){
  const creator=await getActiveCreator();
  const events=getRecentAutomationEvents(creator.id);
  const receipts=getRecentWorkflowReceipts(creator.id);
  const counts={queued:events.filter((event)=>["created","dispatching","queued"].includes(event.status)).length,
    running:events.filter((event)=>event.status==="running").length,
    failed:events.filter((event)=>["failed","dispatch_failed"].includes(event.status)).length,
    completed:events.filter((event)=>event.status==="completed").length};
  return <main className="app-shell"><AppNav active="Automation"/><section className="workspace automation-workspace">
    <header className="topbar"><div><span className="eyebrow">{creator.name.toUpperCase()} · CONTROL PLANE</span><h1>Automation</h1><p className="page-subtitle">Creator-scoped events, Cloudflare queue state, failures and verified workflow receipts.</p></div></header>
    <section className="automation-summary">
      {Object.entries(counts).map(([label,count])=><article key={label}><strong>{count}</strong><span>{label}</span></article>)}
    </section>
    <section className="automation-layout">
      <div className="panel automation-list"><div className="panel-heading"><div><h2>Event queue</h2><p>Every handoff keeps its original idempotency key.</p></div><b>{events.length}</b></div>
        {events.map((event)=><article key={event.id}>
          <div><span>{event.queue} · {event.source}</span><strong>{event.event_type}</strong><small>{event.idempotency_key}</small>{event.error&&<em>{event.error}</em>}</div>
          <div><time>{new Date(event.created_at).toLocaleString("en-AU",{timeZone:"Australia/Perth"})}</time><b className={event.status}>{event.status.replaceAll("_"," ")}</b><small>{event.attempts} attempt{event.attempts===1?"":"s"}</small></div>
          {["failed","dispatch_failed"].includes(event.status)&&<form action={retryAutomationEventAction}><input type="hidden" name="idempotencyKey" value={event.idempotency_key}/><button>Retry</button></form>}
        </article>)}
        {!events.length&&<div className="mini-empty">No automation events have been created for this creator.</div>}
      </div>
      <aside className="panel automation-receipts"><div className="panel-heading"><div><h2>Workflow receipts</h2><p>Completion evidence from Cloudflare and local workers.</p></div><b>{receipts.length}</b></div>
        {receipts.map((receipt)=><article key={receipt.id}><span>{receipt.workflow_type}</span><strong>{receipt.status.replaceAll("_"," ")}</strong><small>{formatDetail(receipt.detail)}</small>{receipt.public_url&&<a href={receipt.public_url} target="_blank" rel="noreferrer">Open live result ↗</a>}<time>{new Date(receipt.created_at).toLocaleString("en-AU",{timeZone:"Australia/Perth"})}</time></article>)}
        {!receipts.length&&<div className="mini-empty">Receipts will appear after a worker acknowledges an event.</div>}
      </aside>
    </section>
  </section></main>;
}
