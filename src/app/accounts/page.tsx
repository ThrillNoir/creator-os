import { redirect } from "next/navigation";
import { getActiveCreator } from "@/lib/current-creator";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const creator = await getActiveCreator();
  redirect(`/creators/${creator.id}`);
}
