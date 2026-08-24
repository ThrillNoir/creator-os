import { createCreatorAction } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { getActiveCreator } from "@/lib/current-creator";
import { getAccounts, getAssetCount, getCreatorReadiness, getCreators, getPostPackages } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CreatorsPage() {
  const activeCreator = await getActiveCreator();
  const creators = getCreators();
  return (
    <AppShell active="Creators">
      <section className="workspace library-workspace">
        <header className="topbar"><div><span className="eyebrow">PRIVATE AGENCY WORKSPACES</span><h1>Managed creators</h1><p className="page-subtitle">Each dashboard keeps its own library, accounts, voice, approvals and reporting.</p></div></header>
        <div className="creator-management-layout">
          <section className="panel creator-workspace-list">
            <div className="panel-heading"><div><h2>Creator workspaces</h2><p>{creators.length} private dashboards</p></div></div>
            {creators.map((creator) => (
              <article className={`managed-creator-row ${creator.id === activeCreator.id ? "active" : ""}`} key={creator.id}>
                <span className="managed-avatar" style={{ background: creator.accent }}>{creator.initials}</span>
                <div><strong>{creator.name}</strong><small>{getAssetCount(creator.id)} assets · {getAccounts(creator.id).length} accounts · {getPostPackages(creator.id).length} post variants</small></div>
                {creator.id === activeCreator.id ? <a className="manage-creator-link" href={`/creators/${creator.id}`}>Manage profile</a> : <b>{getCreatorReadiness(creator.id).completed}/5 ready</b>}
              </article>
            ))}
          </section>
          <section className="panel">
            <div className="panel-heading"><div><h2>Add a creator</h2><p>Creates an isolated setup dashboard and switches into it.</p></div></div>
            <form action={createCreatorAction} className="person-form creator-create-form">
              <label>Creator or stage name<input name="name" required placeholder="Creator name" /></label>
              <label>Workspace colour<input name="accent" type="color" defaultValue="#6f4df6" /></label>
              <button className="primary-button">Create private workspace</button>
            </form>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
