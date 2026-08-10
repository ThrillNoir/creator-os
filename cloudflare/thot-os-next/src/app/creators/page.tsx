import { AppShell, PageHeader } from "@/components/app-shell";
import { cloudflareEnv } from "@/lib/cloudflare";

export default async function CreatorsPage() {
  const creators = await cloudflareEnv().DB.prepare(`
    SELECT c.id,c.name,c.status,COUNT(a.id) AS assets
    FROM creators c LEFT JOIN assets a ON a.creator_id=c.id AND a.source_available=1
    GROUP BY c.id,c.name,c.status ORDER BY c.name
  `).all<{ id: string; name: string; status: string; assets: number }>();
  return <AppShell active="Creators"><PageHeader title="Creators" subtitle="Creator-scoped cloud workspaces." />
    <section className="panel creator-list">{creators.results.map((creator) => <article key={creator.id}><span className="avatar">{creator.name.slice(0,1)}</span><div><strong>{creator.name}</strong><small>{creator.assets} assets · {creator.status}</small></div><span className="state">Connected to D1</span></article>)}</section>
  </AppShell>;
}
