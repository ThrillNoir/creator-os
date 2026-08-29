import { AwsClient } from "aws4fetch";

const PRESIGN_TTL_SECONDS = 5 * 60;
const STAGING_BUCKET = "thot-os-library-media-staging";

type DirectUploadEnv = Omit<CloudflareEnv, "R2_VIDEO_DIRECT_UPLOADS_ENABLED"> & Partial<{
  R2_VIDEO_UPLOAD_ACCESS_KEY_ID: string;
  R2_VIDEO_UPLOAD_SECRET_ACCESS_KEY: string;
  R2_VIDEO_DIRECT_UPLOADS_ENABLED: string;
}>;

function configured(env: DirectUploadEnv) {
  return env.R2_VIDEO_DIRECT_UPLOADS_ENABLED === "1"
    && Boolean(env.R2_VIDEO_UPLOAD_ACCESS_KEY_ID?.trim() && env.R2_VIDEO_UPLOAD_SECRET_ACCESS_KEY?.trim());
}

function objectPath(key: string) {
  return key.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

/** Generates the sole browser authority: a short-lived PUT for one expected
 * part. The multipart ID, canonical key, and signing credentials never enter
 * diagnostics or D1; the signed URL is returned only to its owner. */
export async function presignVideoPartUpload(env: DirectUploadEnv, input: {
  objectKey: string;
  multipartUploadId: string;
  partNumber: number;
  mimeType: string;
}) {
  if (!configured(env)) throw new Error("direct_video_upload_unavailable");
  const endpoint = `https://${"3e7cfa6efb7a97825f1dc24515410c63"}.r2.cloudflarestorage.com`;
  const url = new URL(`${endpoint}/${STAGING_BUCKET}/${objectPath(input.objectKey)}`);
  url.searchParams.set("partNumber", String(input.partNumber));
  url.searchParams.set("uploadId", input.multipartUploadId);
  url.searchParams.set("X-Amz-Expires", String(PRESIGN_TTL_SECONDS));
  const client = new AwsClient({ accessKeyId: env.R2_VIDEO_UPLOAD_ACCESS_KEY_ID!.trim(), secretAccessKey: env.R2_VIDEO_UPLOAD_SECRET_ACCESS_KEY!.trim(), service: "s3", region: "auto" });
  const signed = await client.sign(new Request(url, { method: "PUT", headers: { "content-type": input.mimeType } }), { aws: { signQuery: true } });
  return { uploadUrl: signed.url, expiresAt: new Date(Date.now() + PRESIGN_TTL_SECONDS * 1_000).toISOString() };
}

export function directVideoUploadsAvailable(env: DirectUploadEnv) { return configured(env); }
