import { requireCreatorContext } from "@/lib/identity";
import { getCreatorLaunchReadiness } from "@/lib/launch-readiness";

export async function GET() {
  const context = await requireCreatorContext("manage_identity");
  return Response.json({ ok: true, readiness: await getCreatorLaunchReadiness(context.creator.creator_id) }, {
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
