import Link from "next/link";
import {AppNav} from "@/components/app-nav";
import {getActiveCreator} from "@/lib/current-creator";
import {getCreatorActivity} from "@/lib/db";

export const dynamic="force-dynamic";

export default async function ActivityPage(){
  const creator=await getActiveCreator();
  const activity=getCreatorActivity(creator.id);
  const categories=["content","telegram","reminder","measurement"];
  return <main className="app-shell"><AppNav active="Activity"/><section className="workspace library-workspace">
    <header className="topbar"><div><span className="eyebrow">{creator.name.toUpperCase()} · OPERATING MEMORY</span><h1>Activity timeline</h1><p className="page-subtitle">One creator-scoped history of approvals, handoffs, publication, reminders and measured outcomes.</p></div></header>
    <section className="activity-summary">{categories.map(category=><div key={category}><strong>{activity.filter(item=>item.category===category).length}</strong><span>{category}</span></div>)}</section>
    <section className="panel activity-timeline">
      {activity.map(item=><article key={item.id}><i className={item.category}/><time>{new Date(item.occurredAt).toLocaleString("en-AU",{timeZone:"Australia/Perth"})}</time><div><span>{item.category}</span><strong>{item.title}</strong><small>{item.detail}</small></div><b className={item.status}>{item.status}</b>{item.postPackageId&&<Link href={`/approvals/${item.postPackageId}`}>#{item.postPackageId} →</Link>}</article>)}
      {!activity.length&&<div className="mini-empty">No activity recorded for this creator yet.</div>}
    </section>
  </section></main>;
}
