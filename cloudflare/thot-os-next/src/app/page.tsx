import { AppShell, PageHeader } from "@/components/app-shell";
import { getLibrarySummary } from "@/lib/library";

export default async function OverviewPage() {
  const summary = await getLibrarySummary();
  return <AppShell active="Overview"><PageHeader title="Overview" subtitle="The operational THOT OS interface is being migrated in working modules." />
    <section className="metric-grid"><article><b>1</b><span>Cloud creators</span></article><article><b>{summary?.assets ?? 0}</b><span>Assets</span></article><article><b>{summary?.previews ?? 0}</b><span>Private previews</span></article><article><b>Access</b><span>Identity protected</span></article></section>
    <div className="two-column"><section className="panel"><h2>Migration progress</h2><ol className="roadmap"><li className="done">Cloudflare Access and JWT validation</li><li className="done">Adelaide metadata and private previews</li><li className="done">Full Content Library workflow</li><li className="done">Shared social Operations workspace</li><li className="done">Reddit scheduling and delivery</li><li className="current">Remaining platform workspaces</li><li>Messaging, analytics and finance</li></ol></section><aside className="panel"><h2>Current safety boundary</h2><p>The Mac remains the signed device bridge for Dropbox indexing, browser handoffs and premium-platform native actions.</p></aside></div>
  </AppShell>;
}
