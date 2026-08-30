import { AppShell, PageHeader } from "@/components/app-shell";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { AccessControls } from "./access-controls";

type CredentialListRow = {
  id: string; credential_group: "social" | "paid" | "chrome" | "other"; label: string; username: string; login_email: string;
  account_label: string | null; platform: string | null; shared_with_creator: number; status: string; updated_at: string; last_native_password_confirmation_at: string | null; notes: string;
};
type AccountOption = { id: string; platform: string; label: string };

export default async function AccessPage() {
  const context = await requireCreatorContext("view");
  if (context.creator.role !== "agency_admin" && context.creator.role !== "creator") throw new Error("This role cannot use Access.");
  const { DB } = cloudflareEnv();
  const [credentials, accounts, pin] = await Promise.all([
    DB.prepare(`SELECT vc.id,vc.credential_group,vc.label,vc.username,vc.login_email,oa.label AS account_label,oa.platform,vc.shared_with_creator,vc.status,vc.updated_at,vc.last_native_password_confirmation_at,vc.notes
      FROM vault_credentials vc LEFT JOIN operational_accounts oa ON oa.id=vc.account_id AND oa.creator_id=vc.creator_id
      WHERE vc.creator_id=? AND vc.status='active' ${context.creator.role === "creator" ? "AND vc.shared_with_creator=1" : ""}
      ORDER BY vc.credential_group,vc.updated_at DESC`).bind(context.creator.creator_id).all<CredentialListRow>(),
    DB.prepare("SELECT id,platform,label FROM operational_accounts WHERE creator_id=? AND is_active=1 ORDER BY account_kind,platform,label").bind(context.creator.creator_id).all<AccountOption>(),
    DB.prepare(`SELECT id FROM vault_pin_verifiers WHERE lower(identity_email)=lower(?) AND ((pin_scope='administrator' AND creator_id IS NULL) OR (pin_scope='creator' AND creator_id=?)) LIMIT 1`).bind(context.email, context.creator.creator_id).first<{ id: string }>(),
  ]);
  return <AppShell active="Access">
    <PageHeader eyebrow="STEP-UP PROTECTED" title="Access" subtitle="Passwords are encrypted at rest and are only revealed after a short, creator-scoped PIN confirmation." />
    <AccessControls credentials={credentials.results} accounts={accounts.results} canAdmin={context.creator.role === "agency_admin"} hasPin={Boolean(pin)} />
  </AppShell>;
}
