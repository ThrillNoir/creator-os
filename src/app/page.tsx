import Link from "next/link";
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileImage,
  Plus,
  Send,
  Settings2,
  Sparkles,
} from "lucide-react";
import { sendAgencyMessageToCreatorAction } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActiveCreator } from "@/lib/current-creator";
import {
  getAccounts,
  getAgentTasks,
  getAssetCount,
  getCreatorReadiness,
  getPostPackages,
  getResearchFindings,
  getTelegramCreatorPairing,
  getTelegramSendLog,
} from "@/lib/db";

export const dynamic = "force-dynamic";

const approvalBadgeVariant = {
  approved: "success",
  draft: "warning",
  needs_approval: "warning",
  rejected: "destructive",
} as const;

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

export default async function Home({ searchParams }: { searchParams: Promise<{ telegram?: string }> }) {
  const creator = await getActiveCreator();
  const query = await searchParams;
  const posts = getPostPackages(creator.id);
  const accounts = getAccounts(creator.id);
  const research = getResearchFindings(creator.id, true);
  const tasks = getAgentTasks(creator.id);
  const assetCount = getAssetCount(creator.id);
  const readiness = getCreatorReadiness(creator.id);
  const telegramPairing = getTelegramCreatorPairing(creator.id);
  const telegramLog = getTelegramSendLog(creator.id, 12);
  const awaitingApproval = posts.filter((post) => post.status === "needs_approval" || post.status === "draft");
  const approved = posts.filter((post) => post.status === "approved");
  const summary = [
    { icon: FileImage, label: "Assets indexed", value: assetCount, tone: "bg-secondary" },
    { icon: Clock3, label: "Need approval", value: awaitingApproval.length, tone: "bg-warning" },
    { icon: CheckCircle2, label: "Approved handoffs", value: approved.length, tone: "bg-success" },
    { icon: Settings2, label: "Accounts configured", value: accounts.length, tone: "bg-accent" },
  ];

  return (
    <AppShell active="Overview">
      <section className="workspace">
        <PageHeader
          eyebrow={creator.status === "setup" ? "Creator setup" : "Active workspace"}
          title={`${creator.name} dashboard`}
          description="Content operations, human approval and agent work in one creator-scoped view."
          actions={<Button asChild><Link href="/content/new"><Plus aria-hidden="true" /> Prepare content</Link></Button>}
        />

        <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4" aria-label="Workspace summary">
          {summary.map(({ icon: Icon, label, value, tone }) => (
            <Card className="min-w-0" key={label}>
              <CardContent className="flex items-start gap-4 p-5">
                <span className={`grid size-11 shrink-0 place-items-center border-2 border-foreground ${tone}`}><Icon className="size-5 stroke-[2.5]" aria-hidden="true" /></span>
                <div>
                  <p className="os-metric-value text-3xl font-black leading-none">{value}</p>
                  <p className="mt-2 text-xs font-bold uppercase tracking-[.1em] text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        {creator.status === "setup" ? (
          <Card className="mt-7 bg-secondary">
            <CardHeader className="flex-row items-start justify-between gap-5">
              <div><CardTitle>Set up {creator.name}</CardTitle><CardDescription>{readiness.completed} of {readiness.total} essentials complete</CardDescription></div>
              <span className="os-metric-value text-2xl font-black">{Math.round((readiness.completed / readiness.total) * 100)}%</span>
            </CardHeader>
            <CardContent className="p-5">
              <div className="h-3 border-2 border-foreground bg-background" aria-label={`${readiness.completed} of ${readiness.total} essentials complete`}><div className="h-full bg-primary" style={{ width: `${(readiness.completed / readiness.total) * 100}%` }} /></div>
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {readiness.checks.map((check) => <Link className="flex min-h-14 items-center gap-3 border-2 border-foreground bg-card p-3 text-sm font-bold text-card-foreground no-underline transition-colors hover:bg-primary focus-visible:outline-none" href={check.href} key={check.key}>{check.complete ? <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" /> : <CircleAlert className="size-5 shrink-0" aria-hidden="true" />}<span className="min-w-0 flex-1">{check.label}</span></Link>)}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="mt-7 grid gap-7 xl:grid-cols-[minmax(0,1.5fr)_minmax(290px,.75fr)]">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-5">
              <div><CardTitle>Approval queue</CardTitle><CardDescription>Latest creator-specific post variants</CardDescription></div>
              <Button asChild variant="outline" size="sm"><Link href="/approvals">View all</Link></Button>
            </CardHeader>
            <CardContent className="space-y-3 p-5">
              {posts.slice(0, 6).map((post) => (
                <Link className="group grid grid-cols-[auto_minmax(0,1fr)] gap-3 border border-border bg-card p-4 text-card-foreground no-underline transition-colors hover:bg-muted md:grid-cols-[auto_minmax(0,1fr)_auto]" href={`/approvals/${post.id}`} key={post.id}>
                  <span className="grid size-10 place-items-center border-2 border-foreground bg-accent text-xs font-black">{post.platform.slice(0, 2).toUpperCase()}</span>
                  <span className="min-w-0"><strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-sm">{post.asset_count > 1 ? `${post.asset_count}-image carousel` : post.basename}</strong><span className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{post.account_label} · {post.handle}</span></span>
                  <Badge className="col-start-2 justify-self-start md:col-start-auto md:self-center" variant={approvalBadgeVariant[post.status as keyof typeof approvalBadgeVariant] ?? "outline"}>{formatStatus(post.status)}</Badge>
                </Link>
              ))}
              {!posts.length ? <p className="border border-dashed border-border p-5 text-sm text-muted-foreground">No post variants yet. Build the first {creator.name} package.</p> : null}
            </CardContent>
          </Card>

          <aside className="grid content-start gap-5">
            <Card className="bg-primary"><CardHeader><CardTitle>Creative assist</CardTitle><CardDescription>Optional suggestions, always reviewed by a human</CardDescription></CardHeader><CardContent className="space-y-3 p-5 text-sm"><p className="border-2 border-foreground bg-card p-3"><strong>AI suggested captions</strong><span className="mt-1 block text-xs text-muted-foreground">Draft in the creator&apos;s approved voice.</span></p><p className="border-2 border-foreground bg-card p-3"><strong>AI suggested hashtags</strong><span className="mt-1 block text-xs text-muted-foreground">Relevant platform-specific ideas.</span></p></CardContent></Card>
            <Card><CardHeader className="flex-row items-start justify-between gap-5"><div><CardTitle>Agent activity</CardTitle><CardDescription>Approval-gated local tasks</CardDescription></div><Bot className="size-5 shrink-0" aria-hidden="true" /></CardHeader><CardContent className="grid grid-cols-2 gap-3 p-5"><div className="border-2 border-foreground bg-muted p-3"><p className="os-metric-value text-2xl font-black">{tasks.filter((task) => task.status === "awaiting_approval").length}</p><p className="mt-1 text-xs font-bold uppercase text-muted-foreground">Awaiting approval</p></div><div className="border-2 border-foreground bg-muted p-3"><p className="os-metric-value text-2xl font-black">{tasks.filter((task) => task.status === "completed").length}</p><p className="mt-1 text-xs font-bold uppercase text-muted-foreground">Completed drafts</p></div></CardContent></Card>
            <Card className="bg-accent"><CardContent className="p-5"><Sparkles className="size-6" aria-hidden="true" /><p className="mt-5 text-xs font-black uppercase tracking-[.12em]">Research inbox</p><p className="mt-2 text-3xl font-black">{research.length} current signals</p><p className="mt-3 text-sm">Only accepted, unexpired findings are available to {creator.name}&apos;s managing agent.</p><Button asChild variant="outline" size="sm" className="mt-5"><Link href="/research">Review findings</Link></Button></CardContent></Card>
          </aside>
        </div>

        <Card className="mt-7">
          <CardHeader className="flex-row items-start justify-between gap-5"><div><CardTitle>Agency bot thread</CardTitle><CardDescription>Message {creator.name} in the paired private Telegram chat and review every attempted send.</CardDescription></div><Badge variant={telegramPairing ? "success" : "outline"}>{telegramPairing ? "Paired" : "Not paired"}</Badge></CardHeader>
          <CardContent className="p-5">
            {query.telegram === "sent" ? <p className="mb-5 border-2 border-foreground bg-success p-3 text-sm font-bold">Message sent and added to the Telegram log.</p> : null}
            {query.telegram === "failed" ? <p className="mb-5 border-2 border-foreground bg-destructive p-3 text-sm font-bold text-destructive-foreground">Message was not confirmed by Telegram. The failed attempt is recorded below.</p> : null}
            {telegramPairing ? <form action={sendAgencyMessageToCreatorAction} className="border-2 border-foreground bg-muted p-5"><label className="block text-sm font-bold" htmlFor="agency-message">Message to {telegramPairing.telegram_username ? `@${telegramPairing.telegram_username}` : telegramPairing.display_name}</label><textarea id="agency-message" name="message" required maxLength={4000} placeholder={`Write a private agency message to ${creator.name}…`} className="mt-2 block min-h-28 w-full border-2 border-foreground bg-card p-3 text-sm text-card-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" /><div className="mt-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><p className="text-xs text-muted-foreground">Sent only when you press the button. No automatic replies or publication authority.</p><Button type="submit"><Send aria-hidden="true" /> Send via agency bot</Button></div></form> : <p className="border-2 border-foreground bg-warning p-4 text-sm">Pair {creator.name}&apos;s private Telegram chat before sending messages. <Link className="font-bold underline underline-offset-4" href={`/creators/${creator.id}#telegram-mobile`}>Open Telegram setup</Link>.</p>}
            <div className="mt-6"><div className="flex items-center justify-between gap-4 border-b-2 border-border pb-3"><h3 className="text-sm font-black uppercase tracking-[.1em]">Send log</h3><p className="text-xs text-muted-foreground">{telegramLog.length} recent attempts</p></div><div className="mt-3 space-y-2">{telegramLog.map((item) => <Card variant="quiet" className="bg-card" key={item.id}><details><summary className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 p-4 md:grid-cols-[88px_minmax(0,1fr)_auto]"><Badge className="self-start" variant={item.status === "sent" ? "success" : "destructive"}>{item.kind === "message" ? "Message" : item.kind === "post_handoff" ? "Post" : "Reminder"}</Badge><span className="min-w-0"><strong className="block text-sm">{item.title}</strong><span className="mt-1 block text-xs text-muted-foreground">{new Date(item.occurred_at).toLocaleString("en-AU", { timeZone: "Australia/Perth" })}</span></span><Badge className="col-start-2 justify-self-start md:col-start-auto" variant={item.status === "sent" ? "success" : "destructive"}>{item.status}</Badge></summary><div className="border-t border-border p-4"><pre className="overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{item.content}</pre>{item.error ? <p className="mt-3 text-sm font-bold text-destructive">{item.error}</p> : null}</div></details></Card>)}{!telegramLog.length ? <p className="border border-dashed border-border p-5 text-sm text-muted-foreground">Nothing has been sent to this creator through the agency bot yet.</p> : null}</div></div>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
