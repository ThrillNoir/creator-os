import { AppShell, PageHeader } from "@/components/app-shell";
import { getLibrarySummary } from "@/lib/library";
import { requireCreatorContext } from "@/lib/identity";
import { isCreatorPortalRole } from "@/lib/authorization";

export default async function OverviewPage() {
  const context = await requireCreatorContext();
  const summary = await getLibrarySummary(context.creator.creator_id);
  if (isCreatorPortalRole(context.creator.role)) {
    const readOnly = context.creator.role === "viewer";
    return <AppShell active="Overview"><PageHeader title={context.creator.creator_name} subtitle="Your private THOT OS creator workspace." />
      <section className="metric-grid"><article><b>{summary?.assets ?? 0}</b><span>Assets</span></article><article><b>{summary?.previews ?? 0}</b><span>Private previews</span></article><article><b>{readOnly ? "Viewer" : "Creator"}</b><span>Workspace role</span></article><article><b>Access</b><span>Identity protected</span></article></section>
      <div className="two-column"><section className="panel"><h2>{readOnly ? "Read-only access" : "Creator workspace"}</h2><p>{readOnly ? "You can inspect this workspace and its content library. Changes and approvals are locked at the interface and server." : "Use the creator-scoped library, operations and messages areas. Every permitted change remains attributed to your signed-in identity and creator role."}</p></section><aside className="panel"><h2>Workspace boundary</h2><p>This portal is fixed to {context.creator.creator_name}. It has no agency controls or creator switcher.</p></aside></div>
    </AppShell>;
  }
  return <AppShell active="Overview"><PageHeader title="Overview" subtitle="The operational THOT OS interface is being migrated in working modules." />
    <section className="metric-grid"><article><b>{context.memberships.length}</b><span>Cloud creators</span></article><article><b>{summary?.assets ?? 0}</b><span>Assets</span></article><article><b>{summary?.previews ?? 0}</b><span>Private previews</span></article><article><b>Access</b><span>Identity protected</span></article></section>
    <div className="two-column"><section className="panel"><h2>Migration progress</h2><ol className="roadmap"><li className="done">Cloudflare Access and JWT validation</li><li className="done">Adelaide metadata and private previews</li><li className="done">Full Content Library workflow</li><li className="done">Shared social Operations workspace</li><li className="done">Reddit scheduling and delivery</li><li className="current">Remaining platform workspaces</li><li>Messaging, analytics and finance</li></ol></section><aside className="panel"><h2>Current safety boundary</h2><p>The Mac remains the signed device bridge for Dropbox indexing, browser handoffs and premium-platform native actions.</p></aside></div>
  </AppShell>;
}
