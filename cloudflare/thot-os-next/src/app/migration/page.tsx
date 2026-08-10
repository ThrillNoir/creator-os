import { AppShell, PageHeader } from "@/components/app-shell";

export default function MigrationPage() {
  return <AppShell active="Migration"><PageHeader title="Migration" subtitle="Capability-by-capability rollout from the local HQ to Cloudflare." />
    <div className="two-column"><section className="panel"><h2>Current cutover</h2><ol className="roadmap"><li className="done">Cloudflare Access identity gate</li><li className="done">Adelaide metadata and private previews</li><li className="done">Next.js/OpenNext application runtime</li><li className="done">Content Library editing and batch workflow</li><li className="done">Operations Overview and account warnings</li><li className="done">Reddit scheduling and API delivery</li><li className="done">Unified Messages foundation and authority controls</li><li className="done">Instagram publishing, analytics and replies</li><li className="done">Two-way agency Telegram thread</li><li className="done">Fansly signed-browser message bridge</li><li className="current">OnlyFans message bridge</li><li>Finance dashboard</li></ol></section><aside className="panel"><h2>One Operations home</h2><p>Reddit, Instagram, TikTok, Threads, Facebook, X, Vault and future platform tools live under Operations. Unified Messages keeps conversations, permissions and delivery logs separate from publishing.</p></aside></div>
  </AppShell>;
}
