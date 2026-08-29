/**
 * S3 upload-part responses expose an HTTP ETag, which is commonly quoted.
 * R2's Workers multipart API instead expects the raw `R2UploadedPart.etag`.
 * Normalize at the browser boundary and again at confirmation as defence in
 * depth; neither path accepts arbitrary response-header text.
 */
export function canonicalR2MultipartPartEtag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const raw = trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  return /^[a-f0-9]{32,64}$/i.test(raw) ? raw.toLowerCase() : null;
}
