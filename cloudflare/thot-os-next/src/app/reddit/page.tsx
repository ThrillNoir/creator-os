import { redirect } from "next/navigation";

export default function LegacyRedditPage() {
  redirect("/operations?platform=reddit");
}
