/**
 * Runs an already-recorded projection attempt.  The caller records durable D1
 * intent before this function is invoked, so a KV projection can never be the
 * first durable state.  The functions are deliberately tiny and dependency
 * free so failure ordering can be tested outside the Workers runtime.
 */
export async function writeProjectionFailClosed({
  write,
  recordFailure,
}: {
  write: () => Promise<void>;
  recordFailure: (reason: "projection_write_failed") => Promise<void>;
}): Promise<void> {
  try {
    await write();
  } catch {
    await recordFailure("projection_write_failed");
    throw new Error("projection_write_failed");
  }
}

export async function markProjectionDeliveredFailClosed({
  markDelivered,
  recordFailure,
}: {
  markDelivered: () => Promise<void>;
  recordFailure: (reason: "projection_receipt_failed") => Promise<void>;
}): Promise<void> {
  try {
    await markDelivered();
  } catch {
    await recordFailure("projection_receipt_failed");
    throw new Error("projection_receipt_failed");
  }
}
