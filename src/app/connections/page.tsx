import { redirect } from "next/navigation";
import { getActiveCreator } from "@/lib/current-creator";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const creator = await getActiveCreator();
  redirect(`/creators/${creator.id}`);
}
