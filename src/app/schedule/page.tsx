import Link from "next/link";
import { approveCreatorReminderAction, markPostPublishedAction, reschedulePostAction, saveCreatorReminderRuleAction, scheduleAtRecommendedTimeAction, sendCreatorReminderAction } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { getActiveCreator } from "@/lib/current-creator";
import { getCreatorReminderRule, getCreatorReminders, getInstagramAnalyticsData, getPostPackages, getScheduledPosts } from "@/lib/db";
import { calculateInstagramTiming } from "@/lib/instagram-timing";

export const dynamic = "force-dynamic";

export default async function SchedulePage({searchParams}:{searchParams:Promise<{reminder?:string}>}) {
  const creator = await getActiveCreator();
  const query=await searchParams;
  const scheduled = getScheduledPosts(creator.id);
  const unscheduled = getPostPackages(creator.id).filter((post) => !post.scheduled_at && post.status !== "published");
  const instagram = getInstagramAnalyticsData(creator.id);
  const timing = calculateInstagramTiming({ media: instagram.media, followerActivity: instagram.followerActivity.map((item) => item.hourly), timeZone: "Australia/Perth", limit: 3 });
  const reminderRule=getCreatorReminderRule(creator.id);
  const reminders=getCreatorReminders(creator.id);
  return (
    <AppShell active="Schedule">
      <section className="workspace library-workspace">
        <header className="topbar"><div><span className="eyebrow">{creator.name.toUpperCase()} · CONSISTENCY</span><h1>Publishing schedule</h1><p className="page-subtitle">Changing an approved posting time returns the variant to approval.</p></div><Link className="primary-button button-link" href="/content/new">＋ Prepare content</Link></header>
        {timing.recommendations.length > 0 && <section className="schedule-intelligence">
          <div><span>INSTAGRAM TIMING · {timing.confidence.toUpperCase()} CONFIDENCE</span><strong>Recommended windows</strong></div>
          {timing.recommendations.map((slot) => <article key={`${slot.weekday}-${slot.hour}`}><b>{slot.weekdayLabel.slice(0, 3)}</b><span>{slot.label.split(" · ")[1]}</span><em>{slot.score}</em></article>)}
          <Link href="/analytics">Why these times? →</Link>
        </section>}
        {query.reminder && <div className={`handoff-result ${query.reminder === "sent" ? "success" : "failed"}`}>{query.reminder === "sent" ? "Approved reminder sent to the paired Telegram chat." : "Reminder delivery failed. The queue retains the error for review."}</div>}
        <div className="schedule-workspace">
          <section className="panel">
            <div className="panel-heading"><div><h2>Timeline</h2><p>{scheduled.length} scheduled variants</p></div></div>
            <div className="schedule-timeline">
              {scheduled.map((post) => (
                <article className="timeline-row" key={post.id}>
                  <div className="timeline-date"><strong>{new Date(post.scheduled_at!).toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}</strong><span>{new Date(post.scheduled_at!).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}</span></div>
                  <span className="platform blue">{post.platform.slice(0, 2).toUpperCase()}</span>
                  <div className="timeline-copy"><Link href={`/approvals/${post.id}`}>{post.asset_count > 1 ? `${post.asset_count}-image carousel` : post.basename}</Link><span>{post.account_label} · {post.status.replaceAll("_", " ")}</span></div>
                  <form action={reschedulePostAction}><input type="hidden" name="id" value={post.id} /><input type="datetime-local" name="scheduledAt" defaultValue={post.scheduled_at?.slice(0, 16)} /><button>Move</button></form>
                  {post.status === "approved" && <form action={markPostPublishedAction}><input type="hidden" name="id" value={post.id} /><button className="published-button">Mark published</button></form>}
                </article>
              ))}
              {scheduled.length === 0 && <div className="mini-empty">No posts scheduled for {creator.name} yet.</div>}
            </div>
          </section>
          <aside className="panel unscheduled-panel">
            <div className="panel-heading"><div><h2>Needs a time</h2><p>Drafts and approved variants</p></div></div>
            {unscheduled.slice(0, 12).map((post) => <div className="unscheduled-item" key={post.id}><Link href={`/approvals/${post.id}`}><span>{post.platform.toUpperCase()}</span><div><strong>{post.account_label}</strong><small>{post.status.replaceAll("_", " ")}</small></div><b>→</b></Link>{post.platform === "instagram" && timing.recommendations.length > 0 && <form action={scheduleAtRecommendedTimeAction}><input type="hidden" name="id" value={post.id} /><button title="Uses the next recommended time and returns approved content to review">Use best slot</button></form>}</div>)}
            {unscheduled.length === 0 && <div className="mini-empty">Nothing waiting to schedule.</div>}
          </aside>
        </div>
        <section className="panel reminder-control">
          <div className="panel-heading"><div><h2>Creator reminders</h2><p>Scheduling prepares drafts. Every Telegram reminder still needs approval and a separate send action.</p></div><span className={`confidence-pill ${reminderRule?.enabled ? "strong" : "early"}`}>{reminderRule?.enabled ? "enabled" : "off"}</span></div>
          <form action={saveCreatorReminderRuleAction} className="reminder-rule-form">
            <label className="toggle-label"><input type="checkbox" name="enabled" value="yes" defaultChecked={Boolean(reminderRule?.enabled)} /> Prepare reminder drafts</label>
            <label>Before post<input type="number" name="leadMinutes" min="5" max="1440" defaultValue={reminderRule?.lead_minutes||30} /><span>minutes</span></label>
            <label>Overdue check<input type="number" name="overdueMinutes" min="5" max="1440" defaultValue={reminderRule?.overdue_minutes||30} /><span>minutes</span></label>
            <button className="handoff-button">Save reminder rules</button>
          </form>
          <div className="reminder-queue">
            {reminders.slice(0,12).map((reminder)=><article key={reminder.id}>
              <div><span>{reminder.reminder_type.replaceAll("_"," ")}</span><strong>{reminder.account_label} · #{reminder.post_package_id}</strong><small>{new Date(reminder.scheduled_for).toLocaleString("en-AU",{timeZone:"Australia/Perth"})}</small></div>
              <p>{reminder.message}</p><b className={reminder.status}>{reminder.status}</b>
              {reminder.status==="draft"&&<form action={approveCreatorReminderAction}><input type="hidden" name="id" value={reminder.id}/><button>Approve</button></form>}
              {reminder.status==="approved"&&<form action={sendCreatorReminderAction}><input type="hidden" name="id" value={reminder.id}/><button>Send now</button></form>}
            </article>)}
            {!reminders.length&&<div className="mini-empty">No reminder drafts. Enable rules and schedule a post to prepare them.</div>}
          </div>
        </section>
      </section>
    </AppShell>
  );
}
