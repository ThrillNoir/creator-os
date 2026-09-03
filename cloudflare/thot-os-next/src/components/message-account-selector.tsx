"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { confirmMessageNavigation } from "@/components/message-quick-reply";

type AccountOption = { id: string; displayName: string; handle: string };

export function MessageAccountSelector({ accounts, selectedAccountId }: { accounts: AccountOption[]; selectedAccountId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <form method="get" action="/messages">
    <input type="hidden" name="platform" value="instagram" />
    <input type="hidden" name="thread" value="" />
    <label>Account<select name="accountId" value={selectedAccountId} disabled={pending} onChange={(event) => {
      if (!confirmMessageNavigation()) { event.currentTarget.value = selectedAccountId; return; }
      const params = new URLSearchParams({ platform: "instagram", accountId: event.currentTarget.value });
      startTransition(() => router.push(`/messages?${params.toString()}`));
    }}>
      {accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName}{account.handle ? ` · ${account.handle}` : ""}</option>)}
    </select></label>
    <noscript><button className="compact-action" type="submit">Show inbox</button></noscript>
  </form>;
}
