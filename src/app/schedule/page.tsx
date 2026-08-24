import Link from "next/link";
import { CheckCircle2, Send, Sparkles } from "lucide-react";
import {
  approveCreatorReminderAction,
  markPostPublishedAction,
  reschedulePostAction,
  saveCreatorReminderRuleAction,
  scheduleAtRecommendedTimeAction,
  sendCreatorReminderAction,
} from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { formatWorkflowStatus, WorkflowEmptyState, WorkflowNotice, WorkflowStatusBadge } from "@/components/publication-workflow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getActiveCreator } from "@/lib/current-creator";
import { getCreatorReminderRule, getCreatorReminders, getInstagramAnalyticsData, getPostPackages, getScheduledPosts } from "@/lib/db";
import { calculateInstagramTiming } from "@/lib/instagram-timing";

export const dynamic = "force-dynamic";

function dateParts(value: string) {
  const date = new Date(value);
  return {
    day: date.toLocaleDateString("en-AU", { timeZone: "Australia/Perth", day: "2-digit", month: "short" }),
    time: date.toLocaleTimeString("en-AU", { timeZone: "Australia/Perth", hour: "numeric", minute: "2-digit" }),
  };
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ reminder?: string }> }) {
  const creator = await getActiveCreator();
  const query = await searchParams;
  const scheduled = getScheduledPosts(creator.id);
  const unscheduled = getPostPackages(creator.id).filter((post) => !post.scheduled_at && post.status !== "published");
  const instagram = getInstagramAnalyticsData(creator.id);
  const timing = calculateInstagramTiming({ media: instagram.media, followerActivity: instagram.followerActivity.map((item) => item.hourly), timeZone: "Australia/Perth", limit: 3 });
  const reminderRule = getCreatorReminderRule(creator.id);
  const reminders = getCreatorReminders(creator.id);

  return (
    <AppShell active="Schedule">
      <section className="workspace workflow-workspace">
        <PageHeader
          eyebrow={`${creator.name} · controlled timing`}
          title="Publishing schedule"
          description="Scheduling prepares local package timing. Changing an approved time returns that exact package to human review; it does not publish anything."
          actions={<div className="workflow-page-actions"><Button asChild><Link href="/content/new">Prepare local drafts</Link></Button></div>}
        />

        {timing.recommendations.length ? <section className="workflow-timing" aria-label="Instagram timing recommendations">
          <div><span>Instagram timing · {timing.confidence} confidence</span><strong>Recommended windows</strong></div>
          {timing.recommendations.map((slot) => <article key={`${slot.weekday}-${slot.hour}`}><b>{slot.weekdayLabel.slice(0, 3)}</b><span>{slot.label.split(" · ")[1]}</span><em>Score {slot.score}</em></article>)}
          <Link href="/analytics">Why these times?</Link>
        </section> : null}

        {query.reminder === "sent" ? <WorkflowNotice variant="success">Approved reminder sent to the paired Telegram chat. This does not confirm that the package was published.</WorkflowNotice> : null}
        {query.reminder === "failed" ? <WorkflowNotice variant="error">Reminder delivery failed. The failed queue record remains available for review.</WorkflowNotice> : null}

        <div className="workflow-schedule-layout">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-5"><div><p className="os-eyebrow">Package timing</p><CardTitle>Scheduled packages</CardTitle><p className="mt-2 text-sm text-muted-foreground">{scheduled.length} scheduled variants. Posting remains a separate human action.</p></div><Badge variant="outline">{scheduled.length} scheduled</Badge></CardHeader>
            <CardContent className="workflow-timeline-list">
              {scheduled.map((post) => {
                const date = dateParts(post.scheduled_at!);
                return <article className="workflow-schedule-row" key={post.id}>
                  <div className="workflow-schedule-date"><strong>{date.day}</strong><span>{date.time}</span></div>
                  <div className="workflow-schedule-copy"><div><WorkflowStatusBadge status={post.status} /><Badge className="shadow-none" variant="outline">{post.platform}</Badge></div><Link href={`/approvals/${post.id}`}>{post.asset_count > 1 ? `${post.asset_count}-image carousel` : post.basename}</Link><p>{post.account_label} · {post.handle}</p></div>
                  <div className="workflow-schedule-actions"><form action={reschedulePostAction}><input name="id" type="hidden" value={post.id} /><label className="sr-only" htmlFor={`scheduled-at-${post.id}`}>Planned time for package #{post.id}</label><input defaultValue={post.scheduled_at?.slice(0, 16)} id={`scheduled-at-${post.id}`} name="scheduledAt" type="datetime-local" /><Button size="sm" type="submit" variant="outline">Save time</Button></form>{post.status === "approved" ? <form action={markPostPublishedAction}><input name="id" type="hidden" value={post.id} /><Button size="sm" type="submit" variant="secondary"><CheckCircle2 aria-hidden="true" />Mark published</Button></form> : null}</div>
                </article>;
              })}
              {!scheduled.length ? <WorkflowEmptyState description={`No ${creator.name} packages have a planned time yet. Choose a draft from the queue and set a time when it is ready for review.`} title="No packages are scheduled" /> : null}
            </CardContent>
          </Card>

          <Card variant="quiet">
            <CardHeader><p className="os-eyebrow">Queue</p><CardTitle>Needs a time</CardTitle><p className="mt-2 text-sm text-muted-foreground">Drafts and approved packages waiting for an intentional time.</p></CardHeader>
            <CardContent className="workflow-unscheduled-list">
              {unscheduled.slice(0, 12).map((post) => <article className="workflow-unscheduled-row" key={post.id}><Link href={`/approvals/${post.id}`}><span>{post.platform.slice(0, 2).toUpperCase()}</span><div><strong>{post.account_label}</strong><small>{formatWorkflowStatus(post.status)} · {post.asset_count > 1 ? `${post.asset_count} assets` : post.basename}</small></div></Link>{post.platform === "instagram" && timing.recommendations.length ? <form action={scheduleAtRecommendedTimeAction}><input name="id" type="hidden" value={post.id} /><Button size="sm" title="Uses the next recommended time and returns approved content to review" type="submit" variant="outline"><Sparkles aria-hidden="true" />Use best slot</Button></form> : null}</article>)}
              {!unscheduled.length ? <p className="workflow-inline-empty">Nothing is waiting for a time.</p> : null}
            </CardContent>
          </Card>
        </div>

        <Card className="workflow-reminders">
          <CardHeader className="flex-row items-start justify-between gap-5"><div><p className="os-eyebrow">Human-approved communication</p><CardTitle>Creator reminders</CardTitle><p className="mt-2 text-sm text-muted-foreground">Scheduling prepares reminder drafts. Every message still needs its own approval and send action.</p></div><Badge variant={reminderRule?.enabled ? "success" : "outline"}>{reminderRule?.enabled ? "Enabled" : "Off"}</Badge></CardHeader>
          <CardContent>
            <form action={saveCreatorReminderRuleAction} className="workflow-reminder-form">
              <label className="workflow-toggle-label"><input defaultChecked={Boolean(reminderRule?.enabled)} name="enabled" type="checkbox" value="yes" /><span>Prepare reminder drafts</span></label>
              <label><span>Before post</span><input defaultValue={reminderRule?.lead_minutes || 30} max="1440" min="5" name="leadMinutes" type="number" /><small>Minutes before planned time</small></label>
              <label><span>Overdue check</span><input defaultValue={reminderRule?.overdue_minutes || 30} max="1440" min="5" name="overdueMinutes" type="number" /><small>Minutes after planned time</small></label>
              <Button type="submit" variant="outline">Save rules</Button>
            </form>
            <div className="workflow-reminder-list">
              {reminders.slice(0, 12).map((reminder) => <article className="workflow-reminder-row" key={reminder.id}><div><span className="workflow-reminder-kind">{reminder.reminder_type.replaceAll("_", " ")}</span><strong>{reminder.account_label} · package #{reminder.post_package_id}</strong><small>{new Date(reminder.scheduled_for).toLocaleString("en-AU", { timeZone: "Australia/Perth" })}</small></div><p>{reminder.message}{reminder.error ? ` Error: ${reminder.error}` : ""}</p><WorkflowStatusBadge status={reminder.status} />{reminder.status === "draft" ? <form action={approveCreatorReminderAction}><input name="id" type="hidden" value={reminder.id} /><Button size="sm" type="submit" variant="outline">Approve</Button></form> : reminder.status === "approved" ? <form action={sendCreatorReminderAction}><input name="id" type="hidden" value={reminder.id} /><Button size="sm" type="submit"><Send aria-hidden="true" />Send now</Button></form> : <span />}</article>)}
              {!reminders.length ? <p className="workflow-inline-empty">No reminder drafts. Enable rules and schedule an approved package to prepare them.</p> : null}
            </div>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
