import { requireCreatorContext } from "@/lib/identity";
import { getDeploymentMetadata } from "@/lib/deployment-metadata";
import { getPreviewProgress } from "@/lib/library";

export async function GET() {
  const startedAt = Date.now();
  try {
    const context = await requireCreatorContext();
    const progress = await getPreviewProgress(context.creator.creator_id);
    const pending = progress.queued + progress.processing;
    console.log(JSON.stringify({ event: "creatoros.preview_status", route: "/api/library/preview-status", phase: "complete", status: 200, durationMs: Date.now() - startedAt, deployment: getDeploymentMetadata(), total: progress.total, ready: progress.ready, queued: progress.queued, processing: progress.processing, failed: progress.failed }));
    return Response.json(progress, { headers: { "cache-control": "private, no-store", ...(pending ? { "retry-after": "5" } : {}) } });
  } catch (error) {
    console.log(JSON.stringify({ event: "creatoros.preview_status", route: "/api/library/preview-status", phase: "failed", status: 500, durationMs: Date.now() - startedAt, deployment: getDeploymentMetadata() }));
    throw error;
  }
}
