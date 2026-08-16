import { AppShell, PageHeader } from "@/components/app-shell";
import { getLibrarySummary } from "@/lib/library";
import { requireCreatorContext } from "@/lib/identity";
import { isCreatorPortalRole } from "@/lib/authorization";
import { getCreatorControlPlaneOverview } from "@/lib/control-plane";

export default async function OverviewPage() {
  const context = await requireCreatorContext();
  const summary = await getLibrarySummary(context.creator.creator_id);
  const controlPlane = await getCreatorControlPlaneOverview(context.creator.creator_id);
  if (isCreatorPortalRole(context.creator.role)) {
    const readOnly = context.creator.role === "viewer";
    return <AppShell active="Overview"><PageHeader title={context.creator.creator_name} subtitle="Your private THOT OS creator workspace." />
      <section className="metric-grid"><article><b>{summary?.assets ?? 0}</b><span>Assets</span></article><article><b>{summary?.previews ?? 0}</b><span>Private previews</span></article><article><b>{readOnly ? "Viewer" : "Creator"}</b><span>Workspace role</span></article><article><b>Access</b><span>Identity protected</span></article></section>
      <div className="two-column"><section className="panel"><h2>{readOnly ? "Read-only access" : "Creator workspace"}</h2><p>{readOnly ? "You can inspect this workspace and its content library. Changes and approvals are locked at the interface and server." : "Use the creator-scoped library, operations and messages areas. Every permitted change remains attributed to your signed-in identity and creator role."}</p></section><aside className="panel"><h2>Workspace boundary</h2><p>This portal is fixed to {context.creator.creator_name}. It has no agency controls or creator switcher.</p></aside></div>
    </AppShell>;
  }
  const unhealthy = controlPlane.integrations.filter((integration) => integration.state !== "CONNECTED");
  return <AppShell active="Overview"><PageHeader title={`${context.creator.creator_name} control plane`} subtitle="Canonical creator-scoped operational state. Healthy systems stay quiet; exceptions require attention." eyebrow="CANONICAL CLOUD CONTROL PLANE" />
    <section className="metric-grid"><article><b>{context.memberships.length}</b><span>Authorized creators</span></article><article><b>{controlPlane.library?.available_assets ?? 0}</b><span>Available assets</span></article><article><b>{controlPlane.integrations.filter((integration) => integration.state === "CONNECTED").length}/{controlPlane.integrations.length}</b><span>Healthy integrations</span></article><article><b>{controlPlane.exceptions.length + unhealthy.length}</b><span>Items requiring attention</span></article></section>
    <div className="two-column"><section className="panel"><div className="section-heading"><div><h2>Operational status</h2><p>{controlPlane.creator?.status ?? "unknown"} workspace · no credentials are displayed here.</p></div><span>{controlPlane.integrations.length} accounts</span></div>
      {controlPlane.integrations.length ? controlPlane.integrations.map((integration) => <article className="identity-row" key={`${integration.platform}-${integration.label}`}><div><strong>{integration.platform} · {integration.label}</strong><small>{integration.state.replaceAll("_", " ")} · {integration.authenticated ? "authenticated" : "not authenticated"} · {integration.serviceGranted ? "service grant present" : "no service grant"}</small><span>{integration.currentError || integration.lastSuccessAt ? integration.currentError || `Last success ${integration.lastSuccessAt}` : "Awaiting first verified operation"}</span></div></article>) : <div className="empty"><b>No operational accounts</b><span>Connect platforms only after the workspace is ready.</span></div>}
    </section><aside className="panel"><h2>Work queues</h2><p><b>{controlPlane.messages?.threads ?? 0}</b> message threads across {controlPlane.messages?.connections ?? 0} connections.</p><p><b>{controlPlane.publishing?.pending ?? 0}</b> pending publishing items · {controlPlane.publishing?.failed ?? 0} failed · {controlPlane.publishing?.published ?? 0} published.</p><small>Legacy queue architecture is not represented as canonical automation.</small></aside></div>
    <section className="panel admin-section"><div className="section-heading"><div><h2>Exceptions requiring operator attention</h2><p>Reconciliation exceptions remain quarantined. This view never changes protected canonical records.</p></div><span>{controlPlane.exceptions.length} open</span></div>
      {controlPlane.exceptions.length ? controlPlane.exceptions.map((exception) => <article className="identity-row" key={exception.id}><div><strong>{exception.domain} · {exception.code.replaceAll("_", " ")}</strong><small>{exception.severity} · {exception.summary}</small><span>{exception.remediation}</span></div></article>) : <div className="empty"><b>No open canonical exceptions</b><span>Continue monitoring integration and provider identity changes.</span></div>}
    </section>
  </AppShell>;
}
