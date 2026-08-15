interface Env {
  DB: D1Database;
  PREVIEWS: R2Bucket;
  PREVIEW_QUEUE: Queue<PreviewQueueMessage>;
  COMPOSIO_API_KEY: string;
}
